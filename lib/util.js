// https://stackoverflow.com/questions/33289726/combination-of-async-function-await-settimeout#33292942
function sleep (ms) {
  return new Promise((resolve, reject) => setTimeout(resolve, ms))
}

async function asyncTimeout (ms, fn, ...args) {
  await sleep(ms)
  return fn(...args)
}

module.exports.sleep = sleep
module.exports.asyncTimeout = asyncTimeout
