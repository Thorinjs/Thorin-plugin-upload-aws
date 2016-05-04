'use strict';

/**
 * This is the Thorin AWS storage for file uploads.
 * */
const initStore = require('./lib/store');
module.exports = function(thorin, opt, pluginName) {
  opt = thorin.util.extend({
    name: 'aws',
    uploader: 'upload'
  }, opt);

  thorin.on(thorin.EVENT.INIT, 'plugin.' + opt.uploader, (pluginObj) => {
    const AwsStorage = initStore(thorin, opt, pluginObj.IStorage);
    pluginObj.registerStorageClass('aws', AwsStorage);
  });
};
module.exports.publicName = 'upload-aws';