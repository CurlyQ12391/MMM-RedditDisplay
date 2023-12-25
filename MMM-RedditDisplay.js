/* Magic Mirror
 * Module: MMM-RedditDisplay
 * 
 * By CurlyQ12391 https://github.com/CurlyQ12391/MMM-RedditDisplay
 * Forked from kjb085 https://github.com/kjb085/MMM-Reddit
 */
const MILLISECONDS_IN_MINUTE = 60 * 1000;

// Function to generate a thumbnail
function generateThumbnail() {
  // Your thumbnail generation logic here
  // Replace the following line with the actual thumbnail data
  return 'data:image/jpeg;base64,...';
}

// Some code to generate thumbnail
const thumbnail = generateThumbnail(); // This is where you create the thumbnail

// Now remove the base64 prefix
const base64Data = thumbnail.replace(/^data:image\/\w+;base64,/, '');


Module.register('MMM-RedditDisplay', {
    /**
     * List of default configurations
     * @type {Object}
     */
    defaults: {
    	subreddit: 'all',
        type: 'hot',
        apiUrl: 'https://www.reddit.com/r/', // Add this line with the base URL
        postIdList: [], // TODO: Implement this
        displayType: 'headlines', // Options: 'headlines', 'image' (for image, if post is album, only 1st image is shown)
        count: 3,
        show: 2,
        width: 250, // In pixels
        updateInterval: 15, // In minutes
        rotateInterval: 30, // In seconds
        forceImmediateUpdate: true,
        characterLimit: null,
        titleReplacements: [],

        // Toggles
        showHeader: true,
        headerType: 'sentence', // Options: 'sentence', 'chained'
        showAll: false, // Alias for all below 'show' toggles (this excludes the showHeader feature)
        showRank: true,
        showScore: true,
        showNumComments: true,
        showGilded: true,
        showAuthor: false,
        showSubreddit: false, // For combo subreddits
        colorText: true,

        // Headlines only
        showThumbnail: true, // Irrelevant for image posts

        // Image only
        maxImageHeight: 250, // In pixels
        imageQuality: 'mid-high', // Options: 'low', 'mid', 'mid-high', 'high'
        showTitle: true, // Non-configurable for text base subs

        // Developer only
        debug: false,
	},

    /**
     * List of all posts
     * @type {Array}
     */
    posts: [],

    /**
     * All posts broken into sets to be rendered
     * @type {Array}
     */
    postSets: [],

    /**
     * List of all posts to be used on next post refresh
     * @type {Array}
     */
    stagedPosts: [],

    /**
     * All posts broken into sets to be rendered to be used on next post refresh
     * @type {Array}
     */
    stagedPostSets: [],

    /**
     * Set to true if there is a new set of posts waiting to be loaded
     * NOTE: Only utitlized in the scenario where a post rotator is being utilized
     * @type {Boolean}
     */
    waitingToDeploy: false,

    /**
     * Config file to send to the node helper
     * @type {Object}
     */
    nodeHelperConfig: {},

    /**
     * Index of post set currently being displayed
     * @type {Number}
     */
    currentPostSetIndex: 0,

    /**
     * Interval timer used to rotate the image/text posts on screen
     * @type {Number}
     */
    rotator: null,

    /**
     * Interval timer used to update the set of posts
     * NOTE: Currently not being cleared or updated after initialized, but keeping
     *       this out of consistency and for posterity's sake
     * @type {Number}
     */
    updater: null,

    /**
     * Determines if the current results returned from reddit has content
     * @type {Boolean}
     */
    hasValidPosts: true,

    /**
     * Timestamp of the most recent time that posts were received
     * NOTE: For debugging purposes
     * @type {Date}
     */
    receivedPostsTime: null,

    /**
     * Set of element id and class names for standardization
     * @type {Object}
     */
    domElements: {
        wrapperId: 'mmm-RedditDisplay-wrapper',
        sliderId: 'mmm-RedditDisplay-slider',
    },

    /**
     * Return an array of CSS files to include
     *
     * @return {Array}
     */
    getStyles () {
        return [
            this.file('MMM-RedditDisplay.css'),
        ];
    },

    /**
     * Send socket notification with user configuration
     *
     * @return {void}
     */
    start () {
        Log.info(`Starting module: ${this.name}`);
        this.log(['Module starting']); // Log statement added

        this.nodeHelperConfig = {
            subreddit: this.config.subreddit,
            type: this.config.type,
            displayType: this.config.displayType,
            count: this.config.count,
            imageQuality: this.config.imageQuality,
            characterLimit: this.config.characterLimit,
            titleReplacements: this.config.titleReplacements
        };

        if (this.config.showAll) {
            this.setConfigShowAll();
        }

        this.initializeUpdate();
        this.setUpdateInterval();
    },

    /**
     * Set the interval used to pole the node helper and
     * retrieve up to date posts from Reddit
     *
     * @return {void}
     */
    setUpdateInterval () {
        this.updater = setInterval(() => {
            this.initializeUpdate();
        }, this.config.updateInterval * 60 * 1000);
    },

    /**
     * Set all required variables to true for showAll functionality
     *
     * @return {void}
     */
    setConfigShowAll () {
        this.config.showRank = true;
        this.config.showScore = true;
        this.config.showThumbnail = true;
        this.config.showTitle = true;
        this.config.showNumComments = true;
        this.config.showGilded = true;
        this.config.showAuthor = true;
        this.config.showSubreddit = true;
    },

    /**
     * Send config to node helper to wait on the retrieval of new posts
     *
     * @return {void}
     */
    initializeUpdate() {
        this.log(['Sending REDDIT_CONFIG notification to node helper:', this.nodeHelperConfig]); // Log statement added
        this.sendSocketNotification('REDDIT_CONFIG', { config: this.nodeHelperConfig });
    },

    /**
     * Handle notification from node_helper and rerender DOM
     *
     * @param  {String} notification
     * @param  {Object} payload
     * @return {void}
     */
    socketNotificationReceived (notification, payload) {
        // This is needed so that initializeRefreshDom doesn't wait
        // for the existing rotator to invoke it
        let isRotatingPosts = this.rotator !== null,
            shouldUpdateImmediately = !isRotatingPosts || this.config.forceImmediateUpdate;

        if (notification === 'REDDIT_POSTS') {
            this.handleReturnedPosts(payload);
        } else if (notification === 'REDDIT_POSTS_ERROR') {
            this.handlePostsError(payload);
        }

        this.log(['is rotating', this.rotator !== null]); // Log statement added
        this.log(['updating immediately', !this.rotator || this.config.forceImmediateUpdate]); // Log statement added

        this.initializeRefreshDom(!this.rotator || this.config.forceImmediateUpdate);
    },

    /**
     * Process a valid payload of posts returned from the node helper
     *
     * @param  {Object} payload
     * @return {void}
     */
         handleReturnedPosts(payload) {
        const hasValidPosts = payload.posts && payload.posts.length > 0;

        this.log(['Received posts from backend', hasValidPosts]); // Log statement added

        if (hasValidPosts) {
            this.log(['Payload Posts (before modification)', payload.posts]); // Log statement added

            // Update the existing posts instead of clearing them
            this.stagedPosts.push(...payload.posts);
            this.log(['Staged Posts (after modification)', this.stagedPosts]); // Log statement added

            this.stagedPostSets = this.getPostSets(this.stagedPosts, this.config.show);
            this.log(['Staged Post Sets', this.stagedPostSets]); // Log statement added
        }
        this.log(['Staged Posts (before sending to frontend)', this.stagedPosts]); // Log statement added

        // Always send the posts to the frontend, whether there are new posts or not
        this.log(['Sending data to the frontend', { posts: this.stagedPosts }]); // Log statement added
        this.sendSocketNotification('REDDIT_POSTS', { posts: this.stagedPosts });

        this.waitingToDeploy = true;
        this.receivedPostsTime = new Date();
    },
    
    /**
     * Perform error handling for a backend error
     *
     * @param  {Object} payload
     * @return {void}
     */
    handlePostsError(payload) {
        this.hasValidPosts = false;
        this.log(['Error fetching posts:', payload.message]);
    },

    /**
     * Chunk posts into sets as defined by user
     *
     * @param  {Array} posts
     * @param  {Number} toShow
     * @return {Array}
     */
    getPostSets (posts, toShow) {
        let sets = [];

        // NOTE: Refactored away from using a while (posts.length) { sets.push(posts.splice(0, toShow))}
        // due to a weird variable hoisting/variables passing by reference
        // caused the payload posts array to be empty, despite posts rendering as expected
        // Effectively, we leave this hear for future debugging purposes
        for (let i = 0; i < posts.length; i += toShow) {
            let temp = [];

            for (let ii = i; ii < i + toShow; ii++) {
                temp.push(posts[ii]);
            }

            sets.push(temp);
        }

        return sets;
    },

    /**
     * Return a string to be used as header text
     *
     * @return {String|void}
     */
    getHeader () {
        if (this.config.showHeader) {
            return this.getHeaderText();
        }
    },

    /**
     * Trigger DOM refresh if applicable
     *
     * @param  {Boolean} existingCycleIsComplete
     * @return {void}
     */
    initializeRefreshDom (existingCycleIsComplete) {
        this.log(['initializeRefreshDom called']); // Log statement added
        // If nothing exists in the DOM
        if (this.posts.length === 0) {
            this.log(['posts have no length']); // Log statement added
            this.triggerRefresh(false);
        }
        // If this is called from inside the rotator interval or if
        // no rotator interval exists
        else if (existingCycleIsComplete) {
            this.log(['existing cycle complete']); // Log statement added
            this.triggerRefresh(true);
            this.logTimeBetweenReceiveAndRefresh();
        }

        // If existing cycle is not complete, this function will be called again by the rotator
        // once the current cycle is complete
    },

    logTimeBetweenReceiveAndRefresh () {
        let now = new Date(),
            diff = now - this.receivedPostsTime;

        this.log(['time difference', diff]);
    },

    /**
     * Effectively a wrapper for updateDom, with additional logic
     * to ensure that the DOM is correct and gracefully transitions
     *
     * @param  {Boolean} wrapperExists
     * @return {void}
     */
    triggerRefresh (wrapperExists) {
        this.deployPosts();
        this.log(['triggerRefresh called']); // Log statement added

        this.deleteWrapperElement(wrapperExists);
        this.updateDom();
        this.resetStagedPosts();

        if (this.config.show < this.config.count && this.hasValidPosts) {
            this.setRotateInterval();
        }
    },

    /**
     * Migrate staged posts and post sets to the active post and post sets
     *
     * @return {void}
     */
    deployPosts () {
        this.log(['deploying posts']);
        this.posts = this.stagedPosts;
        this.postSets = this.stagedPostSets;
    },

    /**
     * Clear out staged posts and post sets
     *
     * @return {void}
     */
    resetStagedPosts () {
        this.log(['resetting staged posts']);
        this.stagedPosts = [];
        this.stagedPostSets = [];
        this.waitingToDeploy = false;
    },

    /**
     * Get HTML element to be displayed
     * NOTE: Refactor this - ideally implement some sort of templatization
     *
     * @return {Element}
     */
    getDom() {
        this.log('getting dom');
        let wrapperDiv = document.createElement('div'),
            postsDiv = document.createElement('div');
        headerElement = document.createElement('header'),
        sliderElement = null,
        postSets = this.postSets;

        wrapperDiv.id = this.domElements.wrapperId;
        wrapperDiv.style.width = this.config.width + 'px';

        if (!this.hasValidPosts) {
            let text = document.createElement('div');

            text.innerHTML = 'No valid posts to display<br />Check the console for a full description of error.';
            postsDiv.appendChild(text);
        } else if (!this.postSets) {
            let text = document.createElement('div');

            text.innerHTML = 'LOADING';
            postsDiv.appendChild(text);
        } else {
            sliderElement = this.getContentSlider(postSets);

            postsDiv.appendChild(sliderElement);
        }

        wrapperDiv.appendChild(postsDiv);

        return wrapperDiv;
    },

    /**
     * Clear out the content of the wrapper (i.e. everything but the header)
     *
     * @param  {Boolean}
     * @return {void}
     */
    deleteWrapperElement (wrapperExists) {
        this.log(['deleting wrapper']);
        if (wrapperExists) {
            let wrapperDiv = document.getElementById(this.domElements.wrapperId);

            wrapperDiv.remove();
        }
    },

    /**
     * Get header text based on user configuration
     *
     * @return {String}
     */
    getHeaderText () {
        let header = `${this.config.type} posts from `;

        if (this.config.subreddit === "frontpage" || this.config.subreddit === "") {
            header += "the frontpage";
        } else if (this.helper.isString(this.config.subreddit)) {
            header += "r/" + this.config.subreddit;
        } else {
            if (this.config.headerType === 'chained') {
                header += this.getMultiSubChained(this.config.subreddit);
            } else {
                header += this.getMultiSubSentence(this.config.subreddit);
            }
        }

        return header;
    },

    /**
     * Get sentence defining all subreddits
     *
     * @param  {Array} subs
     * @return {String}
     */
    getMultiSubSentence (subs) {
        let secondToLast = subs.length - 2,
            text = "";

        subs.forEach((sub, idx) => {
            text += "r/" + sub;

            if (idx === secondToLast) {
                text += ", AND ";
            } else if (idx < secondToLast) {
                text += ", ";
            }
        });

        return text;
    },

    /**
     * Get subreddits chained together with +
     *
     * @param  {Array} subs
     * @return {String}
     */
    getMultiSubChained (subs) {
        let text = "r/";

        subs.forEach((sub) => {
            text += sub + '+';
        });

        return text.replace(/\+$/, '');
    },

    /**
     * Get div containing all post data
     * TODO: Refactor this - ideally implement some sort of templatization
     *
     * @param  {Arrray} postSets
     * @return {Element}
     */
    getContentSlider(postSets) {
        let slider = document.createElement('div'),
            idxCounter = 0;

        slider.id = this.domElements.sliderId;

        postSets.forEach((postSet, setIdx) => {
            let tableWrapper = document.createElement('div'),
                table = document.createElement('table');

            table.classList.add('table');

            if (setIdx !== 0) {
                tableWrapper.style.display = 'none';
            }

            postSet.forEach((post, idx) => {
                let postIndex = idx + idxCounter + 1;

                if (this.config.displayType === 'image') {
                    table.appendChild(this.createImageRow(post, postIndex));
                } else {
                    table.appendChild(this.createHeadlineRow(post, postIndex));
                }
            });

            idxCounter += postSet.length;

            tableWrapper.appendChild(table);
            slider.appendChild(tableWrapper);
        });

        return slider;
    },

    /**
     * Create DOM element for the given post
     *
     * @param  {Object} post
     * @param  {Number} postIndex
     * @return {Element}
     */
    createPostRow (post, postIndex) {
        let wrapper = document.createElement('div'),
        imageRow = document.createElement('tr'),
        image = this.getImage(post.src, null, this.config.maxImageHeight),
        imageContainer = document.createElement('div'),
        imageTd = this.getTd(totalColumns, 'col'),
        colored = this.config.colorText ? 'colored' : '',
        row2, row3, showGilded, gildedText;
        
        if (this.config.displayType === 'image') {
            return this.createImageRow(post, postIndex);
        } else {
            return this.createHeadlineRow(post, postIndex);
        }
        return wrapper;
    },

    /**
     * Create DOM element for the given post based on 'headlines' display type
     *
     * @param  {Object} post
     * @param  {Number} postIndex
     * @return {Element}
     */
    createHeadlineRow(post, postIndex) {
        let wrapper = document.createElement('div'),
            row1 = document.createElement('tr'),
            row2 = document.createElement('tr'),
            rowSpan = 2,
            hasTwoRows = true,  // Always have two rows
            rank = this.getTd(rowSpan, 'row'),
            score = this.getTd(rowSpan, 'row'),
            thumbnail = this.getTd(rowSpan, 'row'),
            image = this.getImage(post.thumbnail, 70),
            details = this.getTd(),
            showGilded = this.config.showGilded && post.gilded,
            gildedText = post.gilded > 1 ? 'x' + post.gilded : '',
            colored = this.config.colorText ? 'colored' : '';

        // Always append image to thumbnail td, conditionally append td
        this.appendIfShown(true, thumbnail, image);
        this.appendIfShown(this.config.showThumbnail, row1, thumbnail, 'thumbnail');

        // Append rank and score elements to row1
        this.appendIfShown(this.config.showRank, row1, this.getFixedColumn(rank, ['rank', colored], '#' + postIndex));
        this.appendIfShown(this.config.showScore, row1, this.getFixedColumn(score, ['score', colored], this.formatScore(post.score)));

        // Always show post title for text-based post rows
        this.appendIfShown(true, row1, 'td', 'title', post.title);

        this.appendIfShown(this.config.showNumComments, details, 'span', 'comments', post.num_comments + ' comments');
        this.appendIfShown(showGilded, details, 'span', 'gilded', gildedText);
        this.appendIfShown(this.config.showSubreddit, details, 'span', 'subreddit', 'r/' + post.subreddit);
        this.appendIfShown(this.config.showAuthor, details, 'span', 'author', 'by ' + post.author);

        this.appendIfShown(true, row2, details, 'details');

        wrapper.appendChild(row1);
        wrapper.appendChild(row2);

        wrapper.classList.add('post-row', 'text-row');

        return wrapper;
    },

    /**
     * Create DOM element for image based user config
     * TODO: Refactor this - ideally implement some sort of templatization
     *
     * @param  {Object} post
     * @param  {Number} postIndex
     * @return {Element}
     */
createImageRow(post, postIndex) {
    let hasDetailRow = this.isMultiTextRow(),
        hasTitleRow = this.config.showTitle,
        totalRows = this.getImageRowCount(hasTitleRow, hasDetailRow),
        imageRowOnly = totalRows === 1,
        totalColumns = this.getImageColCount(imageRowOnly),
        wrapper = document.createElement('div'),
        imageRow = document.createElement('tr'),
        imageContainer = document.createElement('div'),
        imageTd = this.getTd(totalColumns, 'col'),
        colored = this.config.colorText ? 'colored' : '',
        row2, row3, showGilded, gildedText;

    // Log thumbnail value
    console.log('Thumbnail:', post.thumbnail);

    // If rank is shown, force onto the 1st row
    this.appendIfShown(imageRowOnly && this.config.showRank, imageRow, this.getFixedColumn(null, ['rank', colored], '#' + postIndex));

    imageContainer.appendChild(this.getImage(post.thumbnail, null, this.config.maxImageHeight));
    imageContainer.classList.add('image-container');

    imageTd.appendChild(imageContainer);
    this.appendIfShown(true, imageRow, imageTd, 'feature-image');

    wrapper.appendChild(imageRow);

    if (hasTitleRow) {
        row2 = document.createElement('tr');

        this.appendIfShown(this.config.showRank, row2, this.getFixedColumn(this.getTd(totalRows - 1, 'row'), ['rank', colored], '#' + postIndex));
        this.appendIfShown(this.config.showScore, row2, this.getFixedColumn(this.getTd(totalRows - 1, 'row'), ['score', colored], this.formatScore(post.score)));
        this.appendIfShown(this.config.showTitle, row2, 'td', 'title', post.title);

        wrapper.appendChild(row2);
    }

    if (hasDetailRow) {
        row3 = document.createElement('tr');
        showGilded = this.config.showGilded && post.gilded;
        gildedText = post.gilded > 1 ? 'x' + post.gilded : '';
        let details = this.getTd();

        this.appendIfShown(this.config.showNumComments, details, 'span', 'comments', post.num_comments + ' comments');
        this.appendIfShown(showGilded, details, 'span', 'gilded', gildedText);
        this.appendIfShown(this.config.showSubreddit, details, 'span', 'subreddit', 'r/' + post.subreddit);
        this.appendIfShown(this.config.showAuthor, details, 'span', 'author', 'by ' + post.author);

        this.appendIfShown(true, row3, details, 'details');
        wrapper.appendChild(row3);
    }

    wrapper.classList.add('post-row', 'image-row');

    return wrapper;
},

    /**
     * Determine if the user configuration require multiple table rows
     *
     * @return {Boolean}
     */
    isMultiTextRow () {
        return this.config.showNumComments || this.config.showGilded ||
            this.config.showAuthor || this.config.showSubreddit;
    },

    /**
     * Get number of table rows for image posts
     *
     * @param  {Boolean} hasTitleRow
     * @param  {Boolean} hasDetailRow
     * @return {Number}
     */
    getImageRowCount (hasTitleRow, hasDetailRow) {
        let rowCount = 1;

        rowCount += hasTitleRow ? 1 : 0;
        rowCount += hasDetailRow ? 1 : 0;

        return rowCount;
    },

    /**
     * Get number of columns for image posts
     *
     * @param  {[type]} onlyOneRow
     * @return {[type]}
     */
    getImageColCount (onlyOneRow) {
        let colCount = 1;

        colCount += this.config.showRank && !onlyOneRow ? 1 : 0;
        colCount += this.config.showScore ? 1 : 0;

        return colCount;
    },

/**
 * Get td element with a nested div to ensure a defined with
 *
 * @param  {Element|null} td
 * @param  {String|Array} className
 * @param  {String|null} html
 * @return {Element}
 */
getFixedColumn(td, className, html) {
    let div = document.createElement('div');

    if (this.helper.argumentExists(className)) {
        if (typeof className === 'string' && className.trim() !== '') {
            this.addClasses(div, className);
        } else if (Array.isArray(className) && className.length > 0) {
            this.addClasses(div, className.join(' '));
        }
    }

    if (!this.helper.argumentExists(td)) {
        td = this.getTd();
    }

    if (this.helper.argumentExists(html)) {
        div.innerHTML = html;
    }

    td.appendChild(div);

    return td;
},

    /**
     * If the first argument is true, append the 3rd argument to the 2nd
     *
     * @param  {Boolean} toShow
     * @param  {Element} appendTo
     * @param  {Element|String} element
     * @param  {String|Array|null} className
     * @param  {Element|String|null} html
     * @return {Element}
     */
    appendIfShown (toShow, appendTo, element, className, html) {
        if (toShow) {
            if (this.helper.isString(element)) {
                element = document.createElement(element);
            }

            if (this.helper.argumentExists(className)) {
                this.addClasses(element, className);
            }

            if (this.helper.argumentExists(html)) {
                if (this.helper.isScalar(html)) {
                    element.innerHTML = html;
                } else {
                    element.appendChild(html);
                }
            }

            appendTo.appendChild(element);
        }

        return appendTo;
    },

    /**
     * Get a td element spanning the given number of rows or columns
     *
     * @param  {Number} spanCount
     * @param  {String} spanType
     * @return {Element}
     */
    getTd (spanCount, spanType) {
        let td = document.createElement('td')

        if (this.helper.argumentExists(spanCount)) {
            td[spanType + 'Span'] = spanCount;
        }

        return td;
    },

/**
 * Add classes to the given element
 *
 * @param {Element} element
 * @param {String|Array} classes
 * @return {void}
 */
 addClasses(element, classes) {
    if (this.helper.isString(classes)) {
        // Split class names and add each one individually
        classes.split(/\s+/).forEach(className => {
            if (className.trim() !== '') {
                element.classList.add(className.trim());
            }
        });
    } else if (Array.isArray(classes)) {
        // Strip out empty strings and add each class from the array
        classes.filter((item) => item.trim() !== '').forEach(className => {
            element.classList.add(className.trim());
        });
    }
},

    /**
     * Return an image element or div with a class name that utilizes a background image
     *
     * @param  {String} source
     * @param  {Number} width
     * @param  {Number} maxHeight
     * @return {Element}
     */
    getImage(source, width, maxHeight, displayType) {
        let image;

        if (displayType === 'headlines' && source && source.trim() !== '') {
            // For headlines displayType with base64-encoded thumbnail
            const base64Data = source.replace(/^data:image\/\w+;base64,/, '');
            console.log('Base64 Data:', base64Data);
            
            const blob = new Blob([new Uint8Array(atob(base64Data).split('').map(char => char.charCodeAt(0)))], { type: 'image/jpeg' });
            const blobUrl = URL.createObjectURL(blob);

            image = document.createElement('img');
            image.src = blobUrl;
        } else {
            // For regular images or empty sources
            if (source && source.trim() !== '' && source.indexOf('http') > -1) {
                image = document.createElement('img');
                image.src = source;
            } else {
                image = document.createElement('div');
                image.classList.add(source);
            }
        }

        if (this.helper.argumentExists(width)) {
            image.width = width;
        }

        if (this.helper.argumentExists(maxHeight)) {
            image.style.maxHeight = maxHeight + 'px';
        }

        return image;
    },
    /**
     * Format numbers over 10,000
     *
     * @param  {Number} score
     * @return {Number|String}
     */
    formatScore (score) {
        if (score > 10000) {
            score = (score / 1000).toFixed(1) + 'k';
        }

        return score;
    },

    /**
     * Set interval to cycle through existing post sets
     *
     * @return {void}
     */
    setRotateInterval () {
        this.log(['setting rotator']); // Log statement added
        this.log(['rotator', this.rotator]); // Log statement added
        if (this.rotator !== null) {
            this.log(['unset top']); // Log statement added
            this.unsetRotateInterval();
        }

        this.resetCurrentPostSetIndex();

        this.rotator = setInterval(() => {
            let slider = document.getElementById(this.domElements.sliderId),
                postSets = slider.children,
                nextIndex = this.currentPostSetIndex + 1,
                isLastIndex = nextIndex === postSets.length,
                hasMultipleSets = postSets.length > 1;

            this.log(['rotating', isLastIndex && hasMultipleSets]); // Log statement added
            this.log(['current post set index', this.currentPostSetIndex]); // Log statement added
            this.log(['next index', nextIndex]); // Log statement added

            if (isLastIndex && hasMultipleSets) {
                this.resetCurrentPostSetIndex();
                this.deployPosts();
                this.updateDom();

                // Only unset the interval if it has been more than 2 rotations
                if (this.rotationCount > 1) {
                    this.unsetRotateInterval();
                    this.rotationCount = 0;
                } else {
                    this.rotationCount++;
                }
            } else {
                this.currentPostSetIndex++;
                this.rotatorCycle();
            }
        }, this.config.displayTime * 1000);
    },

    /**
     * Clear interval and for good measure set back to null
     *
     * @return {void}
     */
    unsetRotateInterval () {
        clearInterval(this.rotator);
        this.rotator = null;
        this.log(['rotator', this.rotator]);
    },

    /**
     * Set the currentPostSetIndex back to 0
     * Should only be relevant in scenarios where we force an immediate update,
     * but is good for posterity's sake even if an update isn't force on
     * receiving new posts
     *
     * @return {void}
     */
    resetCurrentPostSetIndex () {
        this.currentPostSetIndex = 0;
        this.log(['resetting currentPostSetIndex']);
    },

    /**
     * Increment the post set index, cylcing back to 0 when the last post set
     * is the current set
     *
     * @return {Number}
     */
    getNextPostSetIndex () {
        let index = this.currentPostSetIndex + 1;;

        if (index === this.postSets.length) {
            index = 0;
        }

        return index;
    },

    /**
     * Wrapper for console log in order to keep debugging code
     * for reuse, but have disabled unless explicitly set
     *
     * @param  {Array} toLog
     * @return {void}
     */
    log (toLog) {
        if (this.config.debug) {
            if (this.helper.isScalar(toLog)) {
                toLog = [toLog];
            }

            console.log.apply(null, toLog);
        }
    },

    /**
     * Helper functions
     *
     * @type {Object}
     */
    helper: {
        /**
         * Determine if the argument is undefined or null
         *
         * @param  {mixed} arg
         * @return {Boolean}
         */
        argumentExists (variable) {
            return typeof variable !== 'undefined' && variable !== null;
        },

        /**
         * Determine if the argument is a string
         *
         * @param  {mixed}  variable
         * @return {Boolean}
         */
        isString (variable) {
            return typeof variable === 'string' || variable instanceof String;
        },

        /**
         * Determine if the argument is a string or a number
         *
         * @param  {mixed}  variable
         * @return {Boolean}
         */
        isScalar (variable) {
            return (/boolean|number|string/).test(typeof variable);
        },
    }
});  
