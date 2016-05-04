'use strict';
const AWS = require('aws-sdk'),
  url = require('url');

/*
 * This is the abstraction over the AWS S3 file uploader.
 * */
module.exports = function(thorin, opt, IStorage) {

  opt = thorin.util.extend({
    logger: opt.logger || 'upload-aws'
  }, opt);

  const config = Symbol(),
    sdk = Symbol(),
    logger = thorin.logger(opt.logger);

  class AwsStorage extends IStorage {
    /*
     * The AWS Storage requires the following options:
     *   - region -> the region of the S3 bucket.
     *   - bucket -> the bucket to use.
     *
     *   - accessKeyId -> the access key
     *   - secretAccessKey -> the secret key.
     *       OR
     *   - key -> the access key
     *   - secret -> the secret key.
     * */
    constructor(options, name) {
      super(name);
      if (options.key) {
        options.accessKeyId = options.key;
        delete options.key;
      }
      if (options.secret) {
        options.secretAccessKey = options.secret;
        delete options.secret;
      }
      this[config] = thorin.util.extend(options, {
        signatureVersion: 'v4'
      });
      if (!this[config].accessKeyId) {
        logger.warn('AWS Storage: missing accessKeyId in configuration');
      }
      if (!this[config].secretAccessKey) {
        logger.warn('AWS Storage: missing secretAccessKey in configuration');
      }
      if (!this[config].bucket) {
        logger.warn('AWS Storage: missing bucket in configuration');
      }
      if (!this[config].region) {
        logger.warn('AWS Storage: missing region in configuration');
      }
      const opt = {
        signatureVersion: this[config].signatureVersion,
        region: this[config].region,
        accessKeyId: this[config].accessKeyId,
        secretAccessKey: this[config].secretAccessKey
      };
      this[sdk] = new AWS.S3(opt);
    }

    /*
     * Store the given file to AWS.
     * */
    save(fileObj) {
      return new Promise((resolve, reject) => {
        const saveOpt = thorin.util.extend({
          Bucket: this[config].bucket,
          Key: fileObj.getKey(),
          ACL: 'public-read',
          ContentType: fileObj.mimeType
        }, fileObj.options || {});
        saveOpt.Body = fileObj.getStream();
        // we now upload it to S3.
        console.log("STORING")
        this[sdk].upload(saveOpt).send((err, data) => {
          if (err) {
            logger.warn('Failed to finalize upload of file ' + opt.params.Key);
            logger.debug(err);
            return reject(thorin.error('UPLOAD.STORAGE_FAILED', 'Could not finalize the file upload', err));
          }
          // IF the file contains any kind of errors, we remove it.
          if (!fileObj.error) {
            fileObj.url = data.Location;
            return resolve();
          }
          // at this point, we have to remove it.
          logger.trace(`Removing failed uploaded image ${data.Location}`);
          resolve();
          this.remove(data.Location).catch((e) => {
            if (e) {
              logger.error(`Failed to remove failed uploaded image ${data.Location}`);
              logger.debug(e);
            }
          });
        });
      });

    }

    /*
     * Checks if we can remove the given URL from aws.
     * */
    canRemove(fileUrl) {
      // TODO.
      return true;
    }

    /*
     * Removes the given URL from S3
     * */
    remove(fileUrl) {
      return new Promise((resolve, reject) => {
        let tmp = url.parse(fileUrl);
        let fileKey = tmp.path;
        if(fileKey.charAt(0) === '/') fileKey = fileKey.substr(1);
        const removeOpt = thorin.util.extend({
          Bucket: this[config].bucket,
          Key: fileKey
        });
        this[sdk].deleteObject(removeOpt, (err, res) => {
          if(err) {
            logger.trace('Failed to remove storage key '+ fileKey);
            return reject(err);
          }
          resolve();
        });
      });
    }

  }

  return AwsStorage;
}