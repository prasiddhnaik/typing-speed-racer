DIR := $(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

dev:
	cd "$(DIR)" && npm run dev

build:
	cd "$(DIR)" && npm run build

preview: build
	cd "$(DIR)" && npm run preview

deploy: build
	cd "$(DIR)" && npx vercel --prod

install:
	cd "$(DIR)" && npm install

.PHONY: dev build preview deploy install
