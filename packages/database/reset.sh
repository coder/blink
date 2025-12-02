#!/usr/bin/env bash

git checkout main -- ./migrations
git clean -fd ./migrations
bun generate