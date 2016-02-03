var shell = require('shelljs');
var fs = require('fs');
var path = require('path');

// don't exit on shelljs errors
shell.set('-e');

module.exports = function(meteorDir) {
  fs.readdirSync(meteorDir).filter(function(file) {
    return /\.webpack-assets.*$/.test(file);
  }).forEach(function(file) {
    var assetFile = path.join(meteorDir, file);
    var assets = JSON.parse(fs.readFileSync(assetFile));
    assets.forEach(function(asset) {
      asset = path.join(meteorDir, asset);
      try {
        shell.rm('-r', asset);
      }
      catch (err) {
        console.error(err.stack);
      }
    });
    try {
      shell.rm(assetFile);
    }
    catch (err) {
      console.error(err.stack);
    }
  });
};
