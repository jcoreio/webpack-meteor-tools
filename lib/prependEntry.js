module.exports = function(options, toPrepend) {
  var entry = options.entry; 
  if (!(entry instanceof Array) && typeof entry !== 'string') {
    for (var key in entry) {
      if (!(entry[key] instanceof Array)) entry[key] = [entry[key]];
      entry[key].unshift(toPrepend);
    }
  }
  else {
    if (!(entry instanceof Array)) {
      entry = options.entry = [entry];
    }
    entry.unshift(toPrepend);
  }
}
