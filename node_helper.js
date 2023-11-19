const fetch = require('node-fetch');
const NodeHelper = require('node_helper');

const qualityIndex = ['low', 'mid', 'mid-high', 'high'];
const baseUrl = 'https://www.reddit.com/';

module.exports = NodeHelper.create({
   start() {
      console.log(`Starting module helper: ${this.name}`);
   },

   socketNotificationReceived(notification, { config }) {
      if (notification === 'REDDIT_CONFIG') {
         this.config = config;
         this.getData();
      }
   },

   sendData(obj) {
      this.sendSocketNotification('REDDIT_POSTS', obj);
   },

   getData() {
      let url = `${baseUrl}r/${this.formatSubreddit(this.config.subreddit)}/${this.config.type}/.json?raw_json=1&limit=${this.config.count}`;
      let posts = [];

      fetch(url)
         .then(response => {
            if (response.status === 200) {
               return response.json();
            } else {
               throw new Error('Request status code: ' + response.status);
            }
         })
         .then(body => {
            if (body.data && body.data.children) {
               body.data.children.forEach(post => {
                  let temp = {
                     title: this.formatTitle(post.data.title),
                     score: post.data.score,
                     thumbnail: post.data.thumbnail,
                     src: this.getImageUrl(post.data.preview, post.data.thumbnail),
                     gilded: post.data.gilded,
                     num_comments: post.data.num_comments,
                     subreddit: post.data.subreddit,
                     author: post.data.author,
                  };

                  if (this.config.displayType !== 'image' || temp.src !== null) {
                     posts.push(temp);
                  }
               });

               this.sendData({ posts: posts });
            } else {
               throw new Error('Invalid response body');
            }
         })
         .catch(error => {
            console.error(error);
            this.sendError(error.message);
         });
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

      replacements.forEach(modifier => {
         let caseSensitive = modifier.caseSensitive !== undefined ? modifier.caseSensitive : true,
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
      let previewUndefined = typeof preview === 'undefined',
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
      console.error(error);
      this.sendSocketNotification('REDDIT_POSTS_ERROR', { message: error });
   },
});
