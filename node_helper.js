/* Magic Mirror
 * Module: MMM-RedditDisplay
 * 
 * By CurlyQ12391 https://github.com/CurlyQ12391/MMM-RedditDisplay
 * Forked from kjb085 https://github.com/kjb085/MMM-Reddit
 */
const axios = require('axios');
const NodeHelper = require('node_helper');

module.exports = NodeHelper.create({
    baseUrl: 'https://www.reddit.com/',
    qualityIndex: ['low', 'mid', 'mid-high', 'high'],

    start() {
        console.log(`Starting module helper: ${this.name}`);
    },

    socketNotificationReceived(notification, payload) {
        if (notification === 'REDDIT_CONFIG') {
            this.config = payload.config;
            this.getData();
        }
    },

    sendData(obj) {
        this.sendSocketNotification('REDDIT_POSTS', obj);
    },

    getData() {
        let url = this.getUrl(this.config),
            posts = [];

        axios.get(url)
            .then(response => {
                if (response.status === 200) {
                    let body = response.data;
                if (typeof body.data !== "undefined") {
                    if (typeof body.data.children !== "undefined") {
                        body.data.children.forEach((post) => {
                            let temp = {};

                            temp.title = this.formatTitle(post.data.title);
                            temp.score = post.data.score;
                            temp.thumbnail = post.data.thumbnail;
                            temp.src = this.getImageUrl(post.data.preview, post.data.thumbnail),
                                temp.gilded = post.data.gilded;
                            temp.num_comments = post.data.num_comments;
                            temp.subreddit = post.data.subreddit;
                            temp.author = post.data.author;

                            if (this.config.displayType !== 'image' || temp.src !== null) {
                                posts.push(temp);
                            }
                        });

                        this.sendData({ posts: posts });
                    } else {
                        this.sendError('No posts returned. Ensure the subreddit name is spelled correctly. ' +
                            'Private subreddits are also inaccessible');
                    }
                } else {
                    this.sendError(['Invalid response body', body]);
                }
            } else {
                this.sendError('Request status code: ' + response.statusCode);
            }
        });
    },

    getUrl(config) {
        let url = this.baseUrl,
            subreddit = this.formatSubreddit(config.subreddit),
            type = config.type,
            count = config.count;

        if (subreddit !== '' && subreddit !== 'frontpage') {
            url += 'r/' + subreddit + '/';
        }

        return url + type + '/.json?raw_json=1&limit=' + count;
    },

    formatSubreddit(subreddit) {
        if (Array.isArray(subreddit)) {
            subreddit = subreddit.join('+');
        }

        return subreddit;
    },

    formatTitle(title) {
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

    getImageUrl(preview, thumbnail) {
        if (this.skipNonImagePost(preview, thumbnail)) {
            return null;
        }

        let allPostImages = this.getAllImages(preview.images[0]),
            imageCount = allPostImages.length,
            qualityIndex = this.qualityIndex.indexOf(this.config.imageQuality),
            qualityPercent = qualityIndex / 4,
            imageIndex;

        if (imageCount > 5) {
            imageIndex = Math.round(qualityPercent * imageCount);
        } else {
            imageIndex = Math.floor(qualityPercent * imageCount);
        }

        return allPostImages[imageIndex].url;
    },

    skipNonImagePost(preview, thumbnail) {
        let previewUndefined = typeof preview === "undefined",
            nonImageThumbnail = thumbnail.indexOf('http') === -1,
            hasImages, firstImageHasSource;

        if (!previewUndefined && !nonImageThumbnail) {
            hasImages = preview.hasOwnProperty('images');

            if (hasImages) {
                firstImageHasSource = preview.images[0].hasOwnProperty('source');

                if (firstImageHasSource) {
                    return false;
                }
            }
        }

        return true;
    },

    getAllImages(imageObj) {
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

    sendError(error) {
        console.log(error);
    },
});
