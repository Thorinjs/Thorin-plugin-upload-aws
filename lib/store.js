'use strict';
const AWS = require('aws-sdk'),
  url = require('url');

/**
 * This is the abstraction over the AWS S3 file uploader.
 * */
module.exports = function (thorin, opt, IStorage) {

  opt = thorin.util.extend({
    logger: opt.logger || 'upload-aws'
  }, opt);

  const logger = thorin.logger(opt.logger);

  class AwsStorage extends IStorage {

    #config = {};
    #sdk = null;

    /**
     * The AWS Storage requires the following options:
     *   - region -> the region of the S3 bucket.
     *   - bucket -> the bucket to use.
     *
     *   - accessKeyId -> the access key
     *   - secretAccessKey -> the secret key.
     *       OR
     *   - key -> the access key
     *   - secret -> the secret key.
     *      OR
     *   - process.env.AWS_ACCESS_KEY_ID
     *   - process.env.AWS_SECRET_ACCESS_KEY
     *   - process.env.AWS_BUCKET
     *   - process.env.AWS_REGION
     * */
    constructor(options, name) {
      super(name || 'aws');
      if (options.key) {
        options.accessKeyId = options.key;
        delete options.key;
      }
      if (options.secret) {
        options.secretAccessKey = options.secret;
        delete options.secret;
      }
      if (!options.accessKeyId && process.env.AWS_ACCESS_KEY_ID) {
        options.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      }
      if (!options.secretAccessKey && process.env.AWS_SECRET_ACCESS_KEY) {
        options.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      }
      if (!options.bucket && process.env.AWS_BUCKET) {
        options.bucket = process.env.AWS_BUCKET;
      }
      if (!options.region && process.env.AWS_REGION) {
        options.region = process.env.AWS_REGION;
      }
      this.#config = thorin.util.extend(options, {
        signatureVersion: 'v4'
      });
      if (!this.#config.accessKeyId) {
        logger.warn('AWS Storage: missing accessKeyId in configuration');
      }
      if (!this.#config.secretAccessKey) {
        logger.warn('AWS Storage: missing secretAccessKey in configuration');
      }
      if (!this.#config.bucket) {
        logger.warn('AWS Storage: missing bucket in configuration');
      }
      if (!this.#config.endpoint && !this.#config.region) {
        logger.warn('AWS Storage: missing region in configuration');
      }
      const opt = {
        signatureVersion: this.#config.signatureVersion,
        accessKeyId: this.#config.accessKeyId,
        secretAccessKey: this.#config.secretAccessKey
      };
      if (this.#config.endpoint) {
        opt.endpoint = this.#config.endpoint;
      } else {
        opt.region = this.#config.region;
      }
      this.#sdk = new AWS.S3(opt);
    }

    get bucket() {
      return this.#config.bucket || null;
    }

    getSdk() {
      return this.#sdk;
    }

    /**
     * Store the given file to AWS.
     * */
    save(fileObj) {
      return new Promise((resolve, reject) => {
        const saveOpt = thorin.util.extend({
          Bucket: this.#config.bucket,
          Key: fileObj.getKey(),
          ACL: 'public-read',
          ContentType: fileObj.mimeType
        }, fileObj.options || {});
        let streamObj = fileObj.getStream();
        if (!streamObj) {
          return reject(thorin.error('UPLOAD.STORE_FAILED', 'Could not complete the file upload.', 400));
        }
        saveOpt.Body = streamObj;
        // we now upload it to S3.
        this.#sdk.upload(saveOpt).send((err, data) => {
          if (err) {
            logger.warn('Failed to finalize upload of file ' + saveOpt.Key);
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

    /**
     * Download a file from the given URL
     * */
    download(fileUrl, opt) {
      if (typeof fileUrl === 'object' && fileUrl) {
        fileUrl = fileUrl.url;
      }
      let fileKey;
      if (typeof fileUrl !== 'string' || !fileUrl) {
        return Promise.reject(thorin.error('UPLOAD.DOWNLOAD_FAILED', 'Downloading requires a URL'));
      }
      if (fileUrl.indexOf('://') !== -1) {
        try {
          let tmp = url.parse(fileUrl);
          fileKey = tmp.pathname;
        } catch (e) {
          return Promise.reject(thorin.error('UPLOAD.DOWNLOAD_FAILED', 'Download URL is not valid'));
        }
      } else {
        fileKey = fileUrl;
      }
      if (fileKey.charAt(0) === '/') fileKey = fileKey.substr(1);

      return new Promise((resolve, reject) => {
        const readOpt = thorin.util.extend({
          Bucket: this.#config.bucket,
          Key: fileKey
        });
        this.#sdk.getObject(readOpt, (e, res) => {
          if (e) {
            logger.warn(`Failed to download file ${fileKey}`);
            logger.debug(e);
            let err = thorin.error('UPLOAD.DOWNLOAD_FAILED', 'Could not download file');
            err.error = e;
            return reject(err);
          }
          let body = res.Body || '';
          if (res.ContentType && res.ContentType.indexOf('text/') !== -1) {
            return resolve(body.toString());
          }
          return resolve(body);
        });
      });
    }

    /**
     * Generates a signed URL to download a file
     * Arguments:
     * - opt.bucket - the bucket name
     * - opt.key - the key name
     * OR
     * - opt - a full URL of the object, we extract the bucket/key from there.
     * RETURNS THE ACTUAL SIGNED URL.
     * */
    getSignedUrl(opt, expire) {
      let params = {};
      if (typeof opt === 'string' && opt) {
        try {
          let d = url.parse(opt);
          opt = {};
          if (!d) throw 1;
          opt.key = d.pathname;
          let bucketName = d.hostname.split('.s3.')[0];
          if (!bucketName) throw 2;
          opt.bucket = bucketName;
        } catch (e) {
          return null;
        }
      } else if (!opt) {
        opt = {};
      }
      if (!opt.bucket) return null;
      if (!opt.key) return null;
      params.Bucket = opt.bucket;
      params.Key = opt.key;
      if (params.Key.charAt(0) === '/') {
        params.Key = params.Key.substr(1);
      }
      if (typeof expire === 'number') opt.expire = expire;
      if (typeof opt.expire === 'undefined') {
        opt.expire = 60;
      }
      params.Expires = opt.expire;
      try {
        let signature = this.#sdk.getSignedUrl('getObject', params);
        return signature;
      } catch (e) {
        logger.debug(`Could not generate signed URL for: ${params.Key}-${params.Bucket}`);
        logger.debug(e);
        return null;
      }
    }

    /**
     * Checks if we can remove the given URL from aws.
     * */
    canRemove(fileUrl) {
      // TODO.
      return true;
    }

    /**
     * Removes the given URL from S3
     * */
    remove(fileUrl) {
      return new Promise((resolve, reject) => {
        let tmp = url.parse(fileUrl);
        let fileKey = tmp.path;
        if (fileKey.charAt(0) === '/') fileKey = fileKey.substr(1);
        const removeOpt = thorin.util.extend({
          Bucket: this.#config.bucket,
          Key: fileKey
        });
        this.#sdk.deleteObject(removeOpt, (err, res) => {
          if (err) {
            logger.trace('Failed to remove storage key ' + fileKey);
            return reject(err);
          }
          resolve(res);
        });
      });
    }

    /**
     * Destroys the instance and all its properties, cleaning up.
     * */
    destroy() {
      this.#config = null;
      this.#sdk = null;
    }

  }

  return AwsStorage;
}
