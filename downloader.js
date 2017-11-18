#!/usr/bin/env node

const cheerio = require('cheerio');
const fs = require('fs');
const request = require('request');
const semver = require('semver');
const tar = require('tar');
const url = require('url');

// This script downloads the latest Kelda deployment engine binary compatible with
// the version of Kelda specified in the package.json in the working directory.
// It is intended for use with our Travis builds to test blueprints against the
// deployment engine.
function run() {
  const packageJSONStr = fs.readFileSync('./package.json');
  const packageJSON = JSON.parse(packageJSONStr);

  const dependencies = packageJSON.dependencies;
  if (dependencies === undefined) {
    console.log('package.json has no dependencies. Nothing to do.');
    return;
  }

  const keldaVersion = dependencies.kelda;
  if (keldaVersion === undefined) {
    console.log('package.json does not require kelda. Nothing to do.');
    return;
  }

  getKeldaVersions().then((availableVersionsMap) => {
    const availableVersions = Object.keys(availableVersionsMap);
    const bestVersion = semver.maxSatisfying(availableVersions, keldaVersion);
    if (bestVersion === null) {
      console.error(`No satisfying version for ${keldaVersion}: ${availableVersions}`);
      process.exit(1);
    }

    const bestVersionURL = availableVersionsMap[bestVersion];
    console.log(`Downloading ${bestVersionURL}`);
    request.get(bestVersionURL)
      .pipe(tar.extract({ strip: 1 }, ['kelda/kelda_linux']))
      .on('finish', () => { fs.renameSync('kelda_linux', 'kelda'); })
      .on('error', console.error);
  }, console.error);
}

// The release root should serve the available releases in a simple index page.
// The releases should be in tarballs in the format version.tar.gz. For
// example, the file for version 0.6.0 should be 0.6.0.tar.gz.
const releaseRoot = 'http://jenkins.kelda.io';

/**
 * getKeldaVersions returns a map of versions to their download link.
 */
function getKeldaVersions() {
  return new Promise((resolve, reject) => {
    request.get(releaseRoot, (err, _, body) => {
      if (err !== null) {
        reject(err);
        return;
      }

      const $ = cheerio.load(body);
      const allLinks = $('a').map((_, elem) => $(elem).attr('href')).get();
      const allTarballs = allLinks.filter(f => f.endsWith('.tar.gz'));

      const versionToURL = {};
      allTarballs.forEach((tarball) => {
        const version = tarball.substring(0, tarball.indexOf('.tar.gz'));

        // The dev version tracks the master branch of the Kelda repository,
        // and is not actually a release version.
        if (version === 'dev') {
          return;
        }

        if (!semver.valid(version)) {
          reject(new Error(`version ${version} is invalid`));
          return;
        }

        const tarballURL = url.resolve(releaseRoot, tarball);
        versionToURL[version] = tarballURL;
      });
      resolve(versionToURL);
    });
  });
}

if (require.main === module) {
  run();
}
