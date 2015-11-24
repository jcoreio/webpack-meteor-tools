var fs = require('fs');
var support = require('source-map-support');

var origRetrieveSourceMap = support.retrieveSourceMap;

var fileContentsCache = {};

function retrieveFile(path) {
  // Trim the path to make sure there is no extra whitespace.
  path = path.trim();
  if (path in fileContentsCache) {
    return fileContentsCache[path];
  }

  var contents;
  try {
    contents = fs.readFileSync(path, 'utf8');
  } catch (e) {
    contents = null;
  }

  return fileContentsCache[path] = contents;
}

function retrieveSourceMappingURL(source) {
  var fileData = retrieveFile(source);

  var re = /\/\/[#@]\s*(useNextSourceMappingURL|sourceMappingURL=([^'"\r\n]+))\s*$/mg;
  var lastMatch;
  var match = re.exec(fileData);
  while (match) {
    if (lastMatch && lastMatch[1] === 'useNextSourceMappingURL') {
      return match[2];
    }
    lastMatch = match;
    match = re.exec(fileData);
  }
  return null;
}

support.install({
  retrieveSourceMap: function(source) {
    var sourceMappingURL = retrieveSourceMappingURL(source);
    if (sourceMappingURL && fs.existsSync(sourceMappingURL)) {
      return {
        url: source,
        map: fs.readFileSync(sourceMappingURL, 'utf8'),
      };
    }
    else {
      return origRetrieveSourceMap(source);
    }
    return null;
  },
});
