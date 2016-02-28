require('babel-polyfill')

import gulp from 'gulp'
import zip from 'gulp-zip'
import babel from 'gulp-babel'
import dox from 'dox'
import glob from 'glob'
import minimist from 'minimist'
import async from 'async'
import fs from 'fs'
import { execSync } from 'child_process'
import AWS from 'aws-sdk'

// Paths
const paths = {
  src: `lib`,
  dest: `.dist`,
  archive: `.archive`
}

const config = {
  s3_bucket: 'aws-example-builds',
  region: 'us-east-1'
}

// Arguments
let knownOptions = {
  string: 'stage',
  default: {
    stage: process.env.NODE_ENV || 'staging'
  }
}
const argv = minimist(process.argv.slice(2), knownOptions)


// Zipfile name
const zipfileName = `${execSync('git rev-parse --short HEAD').toString().replace(/\r?\n|\r/, '')}-${argv.stage}.zip`

// Get handlers from source
function getHandlers () {
  return new Promise(function(resolve, reject) {
    glob(`${paths.src}/**/*.js`, {}, function(err, filenames) {
      if (err) {
        reject(err)
      } else {
        // Get all files from `handlers/` folder
        let files = filenames.filter(val => /.*\/handlers\/.*/.test(val))

        // Create handler object(s) using:
        // name: {name}
        // functionName: {name}
        // description: {description}
        // role: {role}

        let handlers = []
        for(let path of files) {
          let contents = fs.readFileSync(path, 'utf8')
          let obj = dox.parseComments(contents)[0]
          let handler = {}
          handler.path = path
          for(let tag of obj.tags) {
            if(tag.type === 'handler') {
              handler.name = tag.string
              handler.functionName = `${tag.string}`
            } else if(tag.type === 'description') {
              handler.description = tag.string
            } else if(tag.type === 'role') {
              handler.role = tag.string
            }
          }

          // Use function argument to grab a single handler
          if(argv.function) {
            if(argv.function === handler.name) handlers.push(handler)
          } else {
            handlers.push(handler)
          }
        }

        resolve(handlers)
      }
    })
  })
}


// 1. Build step (transpile all lib code)
gulp.task('build', () => {
  gulp.src(`${paths.src}/**/*.js`)
    .pipe(babel({
      presets: ['es2015', 'stage-0']
    }))
    .pipe(gulp.dest(`${paths.dest}/lib`))
})

// 2. Wrap the handlers and create the entry files
gulp.task('handlers', () => {
  return new Promise((resolve, reject) => {
    getHandlers().then(function(handlers) {
      let promises = []
      for(let handler of handlers) {
        let content = `
          require('babel-polyfill');
          var handler = require('./${handler.path.substr(0, handler.path.length-3)}').default;
          if(!handler) throw new Error("No default handler defined in your handler.")
          var fn = handler;
          if(regeneratorRuntime.isGeneratorFunction(handler)) {
            fn = require('co').wrap(handler);
          }
          exports.handler = fn;
        `

        promises.push(new Promise((res, rej) => {
          fs.writeFile(`./.dist/${handler.name}.js`, content, 'utf8', (err) => {
            if(err) res(err)
            else    rej()
          })
        }))

        Promise.all(promises).then(resolve).catch(reject)
      }
    }).catch(reject)
  })
})

// 3. Create zip file
gulp.task('zip', () => {
  gulp.src(`${paths.dest}/**/*`)
    .pipe(zip(zipfileName))
    .pipe(gulp.dest(paths.archive))
})

// 4. Deploy everything
gulp.task('deploy', () => {
  let lambda = new AWS.Lambda({region: config.region})

  return new Promise(function(resolve, reject) {
    let body = fs.createReadStream(`${paths.archive}/${zipfileName}`)
    let s3obj = new AWS.S3({params: {Bucket: config.s3_bucket, Key: zipfileName}})

    s3obj.upload({Body: body}).
      send(function(err, data) {
        if(err)   reject(err)
        else      resolve()
      })
  }).then(getHandlers).then(function(handlers) {
    // Cross-reference with existing Lambda functions
    return new Promise(function(resolve, reject) {
      lambda.listFunctions(null, function (err, data) {
        if (err)  return reject(err)
        let newFunctions = []
        let updateFunctions = []

        for(let handler of handlers) {
          if(data.Functions.find(fn => fn.FunctionName === handler.functionName)) {
            updateFunctions.push(handler)
          } else {
            newFunctions.push(handler)
          }
        }

        resolve({added: newFunctions, updated: updateFunctions})
      })
    })
  }).then(function(functions) {
    // Create new functions and update existing onces
    let operations = []
    let aliases = []

    for(let fn of functions.added) {
      operations.push(function(callback) {
        let params = {
          Code: {
            S3Bucket: config.s3_bucket,
            S3Key: zipfileName
          },
          FunctionName: fn.functionName,
          Handler: `${fn.name}.handler`,
          Role: fn.role,
          Runtime: 'nodejs',
          Description: fn.description,
          MemorySize: 1536,
          Timeout: 30,
          Publish: true
        }

        lambda.createFunction(params, callback)
      })

      // Create function for every stage
      for(let stage of ['production', 'staging']) {
        aliases.push(function(callback) {
          let params = {
            FunctionName: fn.functionName,
            FunctionVersion: '$LATEST',
            Name: stage,
            Description: `${fn.description} on ${stage}`
          }

          lambda.createAlias(params, callback)
        })
      }
    }

    for(let fn of functions.updated) {
      operations.push(function(callback) {
        let params = {
          FunctionName: fn.functionName,
          S3Bucket: config.s3_bucket,
          S3Key: zipfileName,
          Publish: true
        }

        lambda.updateFunctionCode(params, function(err, data) {
          aliases.push(function(cb) {
            let aliasParams = {
              FunctionName: fn.functionName,
              Name: argv.stage,
              Description: `${fn.description} on ${argv.stage}`,
              FunctionVersion: data.Version
            }

            lambda.updateAlias(aliasParams, cb)
          })

          callback(err, data)
        })
      })
    }

    return new Promise(function(resolve, reject) {
      async.parallel(operations, function(err) {
        if(err) reject(err)
        else    resolve(aliases)
      })
    })
  }).then(function(aliases) {
    return new Promise(function(resolve, reject) {
      async.parallel(aliases, function(err) {
        if(err) reject(err)
        else    resolve()
      })
    })
  }).catch(function(err) { console.log(err) })
})
