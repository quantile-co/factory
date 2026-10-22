# ruleid: dockerfile-base-latest-tag
FROM alpine:latest AS build
RUN echo build

# ruleid: dockerfile-base-latest-tag
FROM ubuntu:latest
RUN echo runtime

# ruleid: dockerfile-base-latest-tag
FROM --platform=$BUILDPLATFORM registry.example.org/team/builder:latest AS cross

# ok: dockerfile-base-latest-tag
FROM alpine:3.20 AS pinned
# ok: dockerfile-base-latest-tag
FROM scratch AS final
# ok: dockerfile-base-latest-tag
FROM alpine@sha256:0000000000000000000000000000000000000000000000000000000000000000 AS digest
USER 10001:10001
