FROM mhart/alpine-node:8

ARG PKG_VERSION
ADD ./node_modules ./node_modules
ADD greenkeeper-changes-${PKG_VERSION}.tgz ./
WORKDIR /package

CMD ["npm", "start"]
