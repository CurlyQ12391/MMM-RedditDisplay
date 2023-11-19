/* Magic Mirror
 * Module: MMM-RedditDisplay
 * 
 * By CurlyQ12391 https://github.com/CurlyQ12391/MMM-RedditDisplay
 * Forked from kjb085 https://github.com/kjb085/MMM-Reddit
 */
const MILLISECONDS_IN_MINUTE = 60 * 1000;

Module.register('MMM-RedditDisplay', {
    /**
     * List of default configurations
     * @type {Object}
     */
    defaults: {
        subreddit: 'all',
        type: 'hot',
        postIdList: [], // TODO: Implement this
        displayType: 'headlines', // Options: 'headlines', 'image' (for image, if post is album, only 1st image is shown)
        count: 10,
        show: 5,
        width: 400, // In pixels
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
        showThumbnail: false, // Irrelevant for image posts

        // Image only
        maxImageHeight: 500, // In pixels
        imageQuality: 'mid-high', // Options: 'low', 'mid', 'mid-high', 'high'
        showTitle: true, // Non-configurable for text base subs

        // Developer only
        debug: true,
    },

    posts: [],
    postSets: [],
    stagedPosts: [],
    stagedPostSets: [],
    waitingToDeploy: false,
    nodeHelperConfig: {},
    currentPostSetIndex: 0,
    rotator: null,
    updater: null,
    hasValidPosts: true,
    receivedPostsTime: null,
    domElements: {
        wrapperId: 'MMM-RedditDisplay-wrapper',
        sliderId: 'MMM-RedditDisplay-slider',
    },

    getStyles() {
        return [
            this.file('MMM-RedditDisplay.css'),
        ];
    },

    start() {
        Log.info(`Starting module: ${this.name}`);
        this.nodeHelperConfig = {
            subreddit: this.config.subreddit,
            type: this.config.type,
            displayType: this.config.displayType,
            count: this.config.count,
            imageQuality: this.config.imageQuality,
            characterLimit: this.config.characterLimit,
            titleReplacements: this.config.titleReplacements,
        };

        if (this.config.showAll) {
            this.setConfigShowAll();
        }

        this.initializeUpdate();
        this.setUpdateInterval();
    },

    setUpdateInterval() {
        this.updater = setInterval(() => {
            this.initializeUpdate();
        }, this.config.updateInterval * MILLISECONDS_IN_MINUTE);
    },

    setConfigShowAll() {
        this.config.showRank = true;
        this.config.showScore = true;
        this.config.showThumbnail = true;
        this.config.showTitle = true;
        this.config.showNumComments = true;
        this.config.showGilded = true;
        this.config.showAuthor = true;
        this.config.showSubreddit = true;
    },

    initializeUpdate() {
        this.sendSocketNotification('REDDIT_CONFIG', { config: this.nodeHelperConfig });
    },
    socketNotificationReceived(notification, payload) {
    console.log(`Received notification: ${notification}`, payload);

        if (notification === 'REDDIT_POSTS') {
            this.handleReturnedPosts(payload);
        } else if (notification === 'REDDIT_POSTS_ERROR') {
            this.handlePostsError(payload);
        }

        this.log(['is rotating', this.rotator !== null]);
        this.log(['updating immediately', !this.rotator || this.config.forceImmediateUpdate]);

        this.initializeRefreshDom(!this.rotator || this.config.forceImmediateUpdate);
    },

    handleReturnedPosts(payload) {
        let hasValidPosts = !!payload.posts.length;
        this.log(['Received posts from backend', hasValidPosts]);

        this.hasValidPosts = hasValidPosts;
        this.stagedPosts = payload.posts;
        this.stagedPostSets = this.getPostSets(this.stagedPosts, this.config.show);
        this.waitingToDeploy = true;
        this.receivedPostsTime = new Date();
    },

    handlePostsError(payload) {
        this.hasValidPosts = false;
        this.log([payload.message]);
    },

    getPostSets(posts, toShow) {
        let sets = [];
        for (let i = 0; i < posts.length; i += toShow) {
            let temp = [];
            for (let ii = i; ii < i + toShow; ii++) {
                temp.push(posts[ii]);
            }
            sets.push(temp);
        }
        return sets;
    },

    getHeaderText: function () {
        if (this.posts && this.posts.length > 0) {
            // Assuming the title is part of the post data
            return this.posts[0].title;
        } else {
            return 'Default Header Text';  // Provide a default text in case there are no posts
        }
    },

    initializeRefreshDom(existingCycleIsComplete) {
        if (this.posts.length === 0) {
            this.log(['posts have no length']);
            this.triggerRefresh(false);
        } else if (existingCycleIsComplete) {
            this.log(['existing cycle complete']);
            this.triggerRefresh(true);
            this.logTimeBetweenReceiveAndRefresh();
        }
    },

    logTimeBetweenReceiveAndRefresh() {
        let now = new Date(),
            diff = now - this.receivedPostsTime;
        this.log(['time difference', diff]);
    },

    triggerRefresh(wrapperExists) {
        this.deployPosts();
        this.deleteWrapperElement(wrapperExists);
        this.updateDom();
        this.resetStagedPosts();

        if (this.config.show < this.config.count && this.hasValidPosts) {
            this.setRotateInterval();
        }
    },

    deployPosts() {
        this.log(['deploying posts']);
        this.posts = this.stagedPosts;
        this.postSets = this.stagedPostSets;
    },

    resetStagedPosts() {
        this.log(['resetting staged posts']);
        this.stagedPosts = [];
        this.stagedPostSets = [];
        this.waitingToDeploy = false;
    },

    deleteWrapperElement(wrapperExists) {
        this.log(['deleting wrapper']);
        let wrapperElement = document.getElementById(this.domElements.wrapperId);
        if (wrapperExists && wrapperElement) {
            wrapperElement.remove();
        }
    },

    getDom() {
        console.log('getDom called');
        console.log('Posts:', this.posts);
        console.log('Post Sets:', this.postSets);

        let wrapper = document.createElement('div');
        wrapper.id = this.domElements.wrapperId;
        this.setWrapperStyles(wrapper);

        if (!this.hasValidPosts) {
            wrapper.innerHTML = 'No posts to display.';
            return wrapper;
        }

        let innerWrapper = document.createElement('div');
        innerWrapper.id = this.domElements.sliderId;

        this.postSets.forEach((set, setIndex) => {
            let innerSet = document.createElement('div');
            innerSet.className = 'reddit-inner-set';

            set.forEach((post, postIndex) => {
                innerSet.appendChild(this.createPostElement(post, postIndex, setIndex));
            });

            innerWrapper.appendChild(innerSet);
        });

        wrapper.appendChild(innerWrapper);
        return wrapper;
    },

    setWrapperStyles(wrapper) {
        wrapper.className = 'small';
        wrapper.style.width = this.config.width + 'px';
    },

createPostElement(post, postIndex, setIndex) {
    let postElement = document.createElement('div');
    postElement.className = 'reddit-post';

    if (post && typeof post === 'object') { // Add this check
        if (this.config.showHeader) {
            postElement.appendChild(this.getHeaderElement(post));
        }

        if (this.config.showThumbnail) {
            postElement.appendChild(this.getThumbnailElement(post));
        }

        postElement.appendChild(this.getPostBodyElement(post, postIndex, setIndex));
    }

    return postElement;
},

    
    getHeaderElement(post) {
        if (!post) {
            console.warn('getHeaderElement called with undefined post.');
            return document.createElement('div'); // Return an empty element if post is undefined
        }
    
        let headerElement = document.createElement('div');
        headerElement.className = 'reddit-header';

        let rankElement = document.createElement('span');
        rankElement.className = 'reddit-rank';
        rankElement.innerHTML = post.rank;
        headerElement.appendChild(rankElement);

        let scoreElement = document.createElement('span');
        scoreElement.className = 'reddit-score';
        scoreElement.innerHTML = post.score;
        headerElement.appendChild(scoreElement);

        let commentsElement = document.createElement('span');
        commentsElement.className = 'reddit-comments';
        commentsElement.innerHTML = post.num_comments;
        headerElement.appendChild(commentsElement);

        let gildedElement = document.createElement('span');
        gildedElement.className = 'reddit-gilded';
        gildedElement.innerHTML = post.gilded;
        headerElement.appendChild(gildedElement);

        if (this.config.showAuthor) {
            let authorElement = document.createElement('span');
            authorElement.className = 'reddit-author';
            authorElement.innerHTML = `by ${post.author}`;
            headerElement.appendChild(authorElement);
        }

        if (this.config.showSubreddit) {
            let subredditElement = document.createElement('span');
            subredditElement.className = 'reddit-subreddit';
            subredditElement.innerHTML = `/r/${post.subreddit}`;
            headerElement.appendChild(subredditElement);
        }

        return headerElement;
    },

    getThumbnailElement(post) {
        let thumbnailElement = document.createElement('div');
        thumbnailElement.className = 'reddit-thumbnail';

        let thumbnailImageElement = document.createElement('img');
        thumbnailImageElement.src = post.thumbnail;
        thumbnailImageElement.alt = 'Reddit Thumbnail';

        if (this.config.maxImageHeight) {
            thumbnailImageElement.style.maxHeight = this.config.maxImageHeight + 'px';
        }

        thumbnailElement.appendChild(thumbnailImageElement);

        return thumbnailElement;
    },

getPostBodyElement(post, postIndex, setIndex) {
    let postBodyElement = document.createElement('div');
    postBodyElement.className = 'reddit-body';

    if (post && typeof post === 'object') { // Add this check
        if (this.config.showRank) {
            let rankElement = document.createElement('div');
            rankElement.className = 'reddit-rank-body';
            rankElement.innerHTML = post.rank;
            postBodyElement.appendChild(rankElement);
        }

        if (this.config.showScore) {
            let scoreElement = document.createElement('div');
            scoreElement.className = 'reddit-score-body';
            scoreElement.innerHTML = post.score;
            postBodyElement.appendChild(scoreElement);
        }

        if (this.config.showNumComments) {
            let commentsElement = document.createElement('div');
            commentsElement.className = 'reddit-comments-body';
            commentsElement.innerHTML = post.num_comments;
            postBodyElement.appendChild(commentsElement);
        }

        if (this.config.showGilded) {
            let gildedElement = document.createElement('div');
            gildedElement.className = 'reddit-gilded-body';
            gildedElement.innerHTML = post.gilded;
            postBodyElement.appendChild(gildedElement);
        }

        if (this.config.showAuthor) {
            let authorElement = document.createElement('div');
            authorElement.className = 'reddit-author-body';
            authorElement.innerHTML = `by ${post.author}`;
            postBodyElement.appendChild(authorElement);
        }

        if (this.config.showSubreddit) {
            let subredditElement = document.createElement('div');
            subredditElement.className = 'reddit-subreddit-body';
            subredditElement.innerHTML = `/r/${post.subreddit}`;
            postBodyElement.appendChild(subredditElement);
        }

        if (this.config.showTitle) {
            let titleElement = document.createElement('div');
            titleElement.className = 'reddit-title';
            titleElement.innerHTML = this.getFormattedTitle(post.title);
            postBodyElement.appendChild(titleElement);
        }
    }

    return postBodyElement;
},

    getFormattedTitle(title) {
        // Apply title replacements if configured
        for (let replacement of this.config.titleReplacements) {
            title = title.replace(replacement.search, replacement.replace);
        }

        // Limit the number of characters in the title if configured
        if (this.config.characterLimit && title.length > this.config.characterLimit) {
            title = title.substring(0, this.config.characterLimit) + '...';
        }

        return title;
    },

    setRotateInterval() {
        if (this.rotator) {
            clearInterval(this.rotator);
        }

        this.log(['setting rotate interval', this.config.rotateInterval]);

        this.rotator = setInterval(() => {
            this.rotate();
        }, this.config.rotateInterval * MILLISECONDS_IN_MINUTE);
    },

    rotate() {
        this.currentPostSetIndex = this.getNextPostSetIndex();
        this.log(['rotating', this.currentPostSetIndex]);

        this.updateDom();
    },

    getNextPostSetIndex() {
        return (this.currentPostSetIndex + 1) % this.postSets.length;
    },

    log(toLog) {
        if (this.config.debug) {
            console.log(Array.isArray(toLog) ? [...toLog] : toLog);
        }
    },

    suspend() {
        this.log('Suspending module.');
        clearInterval(this.rotator);
        clearInterval(this.updater);
    },

    resume() {
        this.log('Resuming module.');
        this.setUpdateInterval();
        this.initializeUpdate();
    },
});
