const envalid = require('envalid')
const {str, url, json, bool, num} = envalid

const urlArray = envalid.makeValidator(x => {
  const urls = json()._parse(x)
  if (!Array.isArray(urls)) throw new Error('JSON is no array')
  return urls.map(url()._parse).filter(Boolean)
})

const environmentConfig = {
  AMQP_URL: url({devDefault: 'amqp://localhost'}),
  REGISTRY_URLS: urlArray({default: '["https://replicate.npmjs.com/registry"]'}),
  REDIS_URL: url({default: 'redis://redis:6379', devDefault: 'redis://localhost:6379'}),
  REDIS_SEQ_KEY: str({default: 'changes-seq'}),
  QUEUE_NAME: str({default: 'events'}),
  NODE_ENV: str({choices: ['development', 'staging', 'production'], devDefault: 'development'}),
  STATSD_HOST: str({default: '172.17.0.1'}),
  REGISTRY_CHANGE_DELAY: num({default: 1000 * 60, devDefault: 1000}),
  IS_ENTERPRISE: bool({default: false})
}

if (!process.env.IS_ENTERPRISE) {
  environmentConfig.ROLLBAR_TOKEN_CHANGES = str({devDefault: ''})
}

module.exports = envalid.cleanEnv(process.env, environmentConfig)
