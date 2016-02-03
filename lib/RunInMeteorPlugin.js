var fs = require('fs');
var path = require('path');
var shell = require('shelljs');
var ConcatSource = require("webpack/lib/ConcatSource");
var prependEntry = require('./prependEntry');
var _ = require('lodash');

// don't exit on shelljs errors
shell.set('-e');

function findMeteorDir(childPath) {
  if (!childPath) {
    return;
  }
  if (fs.existsSync(path.join(childPath, '.meteor/packages')) &&
      fs.existsSync(path.join(childPath, '.meteor/platforms')) &&
      fs.existsSync(path.join(childPath, '.meteor/release')) &&
      fs.existsSync(path.join(childPath, '.meteor/versions'))) {
    return childPath;
  }
  var parent = path.dirname(childPath);
  if (parent && parent !== childPath) {
    return findMeteorDir(parent);
  }
}

function isDev(str) {
  return ['dev', 'devel', 'develop', 'development'].indexOf(str) >= 0;
}

function isProd(str) {
  return ['prod', 'production'].indexOf(str) >= 0;
}

function RunInMeteorPlugin(options) {
  this.options = options;
  options.mode = options.mode || process.env.NODE_ENV;

  if ('NODE_ENV' in process.env && options.mode !== process.env.NODE_ENV) {
    console.warn('RunInMeteorPlugin: options.mode and process.env.NODE_ENV differ.  Using options.mode.');
  }

  if (!findMeteorDir(options.path)) {
    throw new Error("options.path must be a Meteor directory or a subpath of it");
  }
  if (options.target !== 'client' && options.target !== 'server') {
    throw new Error("options.target must be 'client' or 'server'");
  }
  if (!isDev(options.mode) && !isProd(options.mode)) {
    throw new Error("options.mode must be 'development' or 'production' (or an abbreviation)");
  }
  if (!options.key) {
    throw new Error('you must provide options.key');
  }
}

var serverBanner = 'var require = Npm.require;\n';

RunInMeteorPlugin.prototype.apply = function(compiler) {
  var outputDir = this.options.path;
  var meteorDir = findMeteorDir(outputDir);
  var key = this.options.key;
  var target = this.options.target;
  var mode = this.options.mode;
  var chunkNames = this.options.chunkNames;
  var assetsFile = path.join(meteorDir, '.webpack-assets-' + key);

  var sourceMapSupportInstalled = false;


  function createLoadClientBundleHtml(publicPath) {
    return '<head>\n' +
           '  <script type="text/javascript" src="' + publicPath + '"></script>\n' +
           '</head>\n';
  }

  if (target === 'server') {
    compiler.plugin("compilation", function(compilation) {
      if (isDev(mode) && !sourceMapSupportInstalled) {
        var installSourceMapSupport = path.join(__dirname, 'installSourceMapSupport');
        prependEntry(compilation.options, installSourceMapSupport);
        sourceMapSupportInstalled = true;
      }

      var outputPath = compilation.compiler.outputPath;
      compilation.plugin("optimize-chunk-assets", function(chunks, callback) {
        chunks.forEach(function(chunk) {
          chunk.files.filter(function(file) {
            return /\.js$/.test(file);
          }).forEach(function(file) {
            compilation.assets[file] = new ConcatSource(serverBanner, compilation.assets[file],
              '\n//# useNextSourceMappingURL' +
              '\n//# sourceMappingURL=' + path.join(outputPath, file) + '.map\n');
          });
        });
        callback();
      });
    });
  }

  var hasRun = false;

  compiler.plugin('done', function(stats) {
    var firstTime = !hasRun;
    if (firstTime) {
      hasRun = true;
    }
    else {
      if (target === 'client' && isDev(mode)) {
        return;
      }
    }

    // clean out stale prod assets if running in dev mode and vice versa
    if (fs.existsSync(assetsFile)) {
      var staleAssets = JSON.parse(fs.readFileSync(assetsFile));
      staleAssets.forEach(function(asset) {
        asset = path.join(meteorDir, asset);
        if (fs.existsSync(asset)) {
          shell.rm('-r', asset);
        }
      });
    }

    var jsonStats = stats.toJson({
      source: false,
      modules: false,
    });

    var outputAssets = [];

    function addAsset(file) {
      outputAssets.push(path.relative(meteorDir, file));
    }

    function writeFile(targetFile, code) {
      addAsset(targetFile);
      fs.writeFileSync(targetFile, code);
    }

    function mkdirp(dir) {
      if (!fs.existsSync(dir)) {
        var parent = path.dirname(dir);
        if (!fs.existsSync(parent)) {
          mkdirp(parent);
        }
        addAsset(dir);
        shell.mkdir(dir);
      }
    }

    mkdirp(outputDir);

    var assetMap = _.indexBy(jsonStats.assets, function(asset) { return asset.name; });

    var assetsToProcess;
    if (chunkNames) {
      var chunkNameMap = {};
      chunkNames.forEach(function(name) {
        chunkNameMap[name] = true;
      });
      assetsToProcess = [];
      for (var chunkName in jsonStats.assetsByChunkName) {
        if (chunkNameMap.hasOwnProperty(chunkName)) {
          var assetsByChunkName = jsonStats.assetsByChunkName[chunkName];
          if (typeof assetsByChunkName === 'string') assetsByChunkName = [assetsByChunkName];
          assetsToProcess = assetsToProcess.concat(assetsByChunkName.map(function(assetName) {
            return assetMap[assetName];
          }));
        }
      }
    }
    else {
      assetsToProcess = jsonStats.assets;
    }
    assetsToProcess.forEach(function(asset) {
      var assetPath = path.join(compiler.options.output.path, asset.name);

      function justCopy(target) {
        target = target || path.join(outputDir, asset.name);
        addAsset(target);
        shell.cp('-f', assetPath, target);
      }

      if (!/\.js$/.test(asset.name) && compiler.options.devServer) {
        return;
      }

      if (!/\.(js|map)$/.test(asset.name)) {
        return justCopy();
      }

      if (target === 'client' && isProd(mode)) {
        justCopy();
      }
      else if (target === 'server') {
        if (isDev(mode)) {
          if (/\.map$/.test(asset.name)) {
            return;
          } 
          justCopy();
        }
        else if (isProd(mode)) {
          if (/\.js$/.test(asset.name)) {
            return justCopy(path.join(outputDir, asset.name));
          }
          justCopy();
        }
        else {
          justCopy();
        }
      }
    });
    if (target === 'client') {
      jsonStats.chunks.forEach(function(chunk) {
        if (chunk.entry) {
          chunk.files.forEach(function(file) {
            if (!/\.js$/.test(file)) return;

            var loadClientBundleHtml = createLoadClientBundleHtml(jsonStats.publicPath + file);
            var targetFile;
            if (isDev(mode)) {
              targetFile = path.join(outputDir, 'load.' + file + '.html');
            }
            else if (isProd(mode) && path.relative(meteorDir, outputDir).startsWith('public')) {
              targetFile = path.join(meteorDir, 'client', 'load.' + file + '.html');
            }
            writeFile(targetFile, loadClientBundleHtml);
          });          
        } 
      });
    }

    // log what assets we output to Meteor dir so we can clean them out after next compile
    fs.writeFileSync(assetsFile, JSON.stringify(outputAssets, null, "  "));
  });
};

module.exports = RunInMeteorPlugin;
