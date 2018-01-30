const envalid = require('envalid')
const {str, url, json, bool} = envalid

const urlArray = envalid.makeValidator(x => {
  const urls = json()._parse(x)
  if (!Array.isArray(urls)) throw new Error('JSON is no array')
  return urls.map(url()._parse).filter(Boolean)
})

module.exports = envalid.cleanEnv(process.env, {
  AMQP_URL: url({devDefault: 'amqp://localhost'}),
  REGISTRY_URLS: urlArray({default: '["https://replicate.npmjs.com/registry"]'}),
  REDIS_URL: url({default: 'redis://redis:6379', devDefault: 'redis://localhost:6379'}),
  REDIS_SEQ_KEY: str({default: 'changes-seq'}),
  QUEUE_NAME: str({default: 'events'}),
  NODE_ENV: str({choices: ['development', 'staging', 'production'], devDefault: 'development'}),
  ROLLBAR_TOKEN_CHANGES: str({devDefault: ''}),
  STATSD_HOST: str({default: '172.17.0.1'}),
  IS_ENTERPRISE: bool({default: false})
})
