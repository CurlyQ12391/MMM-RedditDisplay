const fetch = require('node-fetch');
const sharp = require('sharp'); // Import sharp library
const NodeHelper = require('node_helper');

module.exports = NodeHelper.create({

    /**
     * Base url for all requests
     * @type {String}
     */
    baseUrl: 'https://www.reddit.com/',

    /**
     * List of image qualities in ascending order
     * @type {Array}
     */
    qualityIndex: [
        'low',
        'mid',
        'mid-high',
        'high',
    ],

 
    /**
     * Log the the helper has started
     *
     * @return {void}
     */
    start () {
        console.log(`Starting module helper: ${this.name}`);
    },

    /**
     * Handle frontend notification by setting config and initializing reddit request
     *
     * @param  {String} notification
     * @param  {Object} payload
     * @return {void}
     */
    socketNotificationReceived (notification, payload) {
        if (notification === 'REDDIT_CONFIG') {
            console.log('Received REDDIT_CONFIG notification with payload:', payload);
            this.config = payload.config;
            this.getData();
        }
    },

    initialize() {
        // This is where you can set up initial configurations or data.
        // This method is called once when the module is loaded.
    },

    initializeUpdate() {
        // This is where you can set up schedules for periodic updates.
        // This method is called when the module is loaded and at intervals defined by updateInterval.
        this.getData();
        setInterval(() => {
            this.getData();
        }, this.config.updateInterval);
    },

   sendData (obj) {
       console.log('Sending data to the frontend:', obj);
       this.sendSocketNotification('REDDIT_POSTS', { posts: obj.posts });
   },

    /**
     * Make request to reddit and send posts back to MM frontend
     *
     * @return {void}
     */
    async getData() {
        try {
            let url = this.getUrl(this.config),
                posts = [],
                body;

            console.log('Fetching data from URL:', url);

            var response = await fetch(url);

            if (response.status !== 200) {
                console.log(`Error fetching Reddit data: ${response.status} ${response.statusText}`);
                return;
            }

            body = await response.json();

            if (typeof body.data !== 'undefined') {
                if (typeof body.data.children !== 'undefined') {
                    console.log('Received Reddit posts data:', body.data.children);

                    for (const post of body.data.children) {
                        let temp = {};

                        temp.title = this.formatTitle(post.data.title);
                        temp.score = post.data.score;

                        // Use the image URL to generate a thumbnail
                        temp.thumbnail = await this.processThumbnail(post.data.url);

                        temp.src = this.getImageUrl(post);
                        temp.gilded = post.data.gilded;
                        temp.num_comments = post.data.num_comments;
                        temp.subreddit = post.data.subreddit;
                        temp.author = post.data.author;

                        // Skip image posts that do not have images
                        if (this.config.displayType !== 'image' || temp.src !== null) {
                            posts.push(temp);
                        } else {
                            console.log('Skipped post:', post);
                        }
                    }

                    console.log('Processed Posts:', posts);

                    this.sendData({ posts: posts });
                } else {
                    console.log('No children found in Reddit data:', body);
                    this.sendError('No posts returned. Ensure the subreddit name is spelled correctly. ' +
                        'Private subreddits are also inaccessible');
                }
            } else {
                console.log('Invalid response body from Reddit:', body);
                this.sendError(['Invalid response body', body]);
            }
        } catch (error) {
            console.error('Error during Reddit data retrieval:', error);
            this.sendError('An error occurred during Reddit data retrieval');
        }
    },

    async processThumbnail(imageUrl) {
        try {
            const response = await fetch(imageUrl);
            const imageBuffer = await response.buffer();

            // Manually resize the image to a specific width (e.g., 70px)
            const resizedImageBuffer = await sharp(imageBuffer)
                .resize({ width: 70 })
                .toBuffer();

            // Encode the resized image as base64
            return `data:image/jpeg;base64,${resizedImageBuffer.toString('base64')}`;
        } catch (error) {
            console.error('Error processing thumbnail:', error);
            return null;
        }
    },

    /**
     * Get reddit URL based on user configuration
     *
     * @param  {Object} config
     * @return {String}
     */
    getUrl (config) {
        let url = this.baseUrl,
            subreddit = this.formatSubreddit(config.subreddit),
            type = config.type,
            count = config.count;

        if (subreddit !== '' && subreddit !== 'frontpage') {
            url += 'r/' + subreddit + '/';
        }

        return url + type + '/.json?raw_json=1&limit=' + count;
    },

    /**
     * If mutliple subreddits configured, stringify for URL use
     *
     * @param  {String|Array} subreddit
     * @return {String}
     */
    formatSubreddit (subreddit) {
        if (Array.isArray(subreddit)) {
            subreddit = subreddit.join('+');
        }

        return subreddit;
    },

    /**
     * Format the title to return to front end
     *
     * @param  {Object} post
     * @return {String}
     */
    formatTitle (title) {
        let replacements = this.config.titleReplacements,
            limit = this.config.characterLimit,
            originalLength = title.length;

        replacements.forEach((modifier) => {
            let caseSensitive = typeof modifier.caseSensitive !== 'undefined' ? modifier.caseSensitive : true,
                caseFlag = caseSensitive ? '' : 'i',
                search = new RegExp(modifier.toReplace, 'g' + caseFlag),
                replacement = modifier.replacement;

            title = title.replace(search, replacement);
        });

        if (limit !== null) {
            title = title.slice(0, limit).trim();

            if (title.length !== originalLength) {
                title += '...';
            }
        }

        return title;
    },

    /**
     * If applicable, get the URL for the resolution designated by the user
     *
     * @param  {Object} preview
     * @param  {String} thumbnail
     * @return {String}
     */
   getImageUrl(post) {
       return this.skipNonImagePost(post) ? null : post.data.url_overridden_by_dest || null;
   },

   skipNonImagePost(post) {
       if (!post || !post.data || typeof post.data.url_overridden_by_dest !== 'string') {
           return true;
       }

       return false;
   },

    /**
     * Get set of all image resolutions
     *
     * @param  {Object} imageObj
     * @return {Array}
     */
    getAllImages (imageObj) {
        let imageSet = imageObj.resolutions,
            lastImage = imageSet.pop(),
            lastIsSource = lastImage.width === imageObj.source.width &&
                lastImage.height === imageObj.source.height;

        imageSet.push(lastImage);

        if (!lastIsSource) {
            imageSet.push(imageObj.source);
        }

        return imageSet;
    },

    /**
     * Send an error to the frontend
     *
     * @param  {String} error
     * @return {void}
     */
    sendError (error) {
        console.log(error);
        this.sendSocketNotification('REDDIT_POSTS_ERROR', { message: error });
    },
});
