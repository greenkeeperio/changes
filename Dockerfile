FROM mhart/alpine-node:8

ARG PKG_VERSION
ADD greenkeeper-changes-${PKG_VERSION}.tgz ./
WORKDIR /package

CMD ["npm", "start"]
