AWS Lambda API example
=======================

Requirements
------------

Node `^5.0.0`

Getting Started
---------------

Just clone the repo and install the necessary node modules:

```shell
$ git clone https://github.com/davidvanleeuwen/aws-lambda-api-example.git
$ cd aws-lambda-api-example
$ npm install                   # Install Node modules listed in ./package.json (may take a while the first time)
```

Usage
-----

* Make sure you have the right credentials as default profile in `~/.aws/credentials`
* Add handler functions or generators to complete your API.
* Deploying to an stage like `npm run deploy -- --stage=staging`.

Structure
---------

The folder structure is straightforward, but you can change whatever you want. To do so, check the `gulpfile.babel.js` and `package.json`.

```
.
├── lib                    # All your source code in ES6
│   └── v1
│     └── handlers         # These are the handlers that are deployed to Lambda
├── .archive               # When deploying it'll put the deployment package here
└── .dist                  # This will be the post for transpiled code
```