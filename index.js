'use strict';
/**
 * This is the Thorin AWS storage for file uploads.
 * */
const initStore = require('./lib/store');
module.exports = function (thorin, opt) {
  opt = thorin.util.extend({
    name: 'aws',
    uploader: 'upload'
  }, opt);
  let AwsStorage = null;
  thorin.on(thorin.EVENT.INIT, 'plugin.' + opt.uploader, (pluginObj) => {
    AwsStorage = initStore(thorin, opt, pluginObj.IStorage);
    pluginObj.registerStorageClass('aws', AwsStorage);

    /**
     * Manually create a storage instance.
     * */
    pluginObj.create = function CreateInstance(name, opt) {
      return new AwsStorage(opt, name);
    }
  });

  const pluginObj = {};
  pluginObj.getStorage = function () {
    return AwsStorage;
  };
  pluginObj.options = opt;

  return pluginObj;
};
module.exports.publicName = 'upload-aws';
