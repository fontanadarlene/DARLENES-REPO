This is an implementation of the Multi-Party Encrypted Messaging Protocol, by
MEGA limited, as a JavaScript library. Its main purpose is to be used within a
JavaScript web application that provides end-to-end secure group messaging.

**THIS IS EXPERIMENTAL SOFTWARE AND SHOULD NOT BE USED IN SECURITY-CRITICAL
SITUATIONS**. Eventually we want to get there, though, so any and all help
reviewing our design and implementation would be appreciated!

In particular, *the wire packet format and protocol version number have not
been stabilised.* The version is currently emitted as `1` on the wire, but we
*will* be making incompatible changes while retaining this numbering. *You
should not* distribute this library in a way that leaves old copies of it lying
around on your users' computers, which may not interoperate with newer versions
that use the same protocol version. *We will actively break such situations*
and *we accept no responsibility* if your users suffer because you ignored
these basic instructions. Eventually we will commit to a stable wire format
that remains backwards- and forwards-compatible within major versions, but now
is not yet the right time to do that.

## Documentation

If you are reading this directly from the source repository, you should skip
this section. If you are reading this as part of the generated documentation,
you should start with one of:

- [API documentation](../api/module-mpenc.html) - for clients that wish
  to use this library in their applications.
- [developer docs](../dev/module-mpenc.html) - for developers that wish
  to contribute patches or new features to this library.

## Test dependencies

Install PhantomJS 2 (see below) *or* `xvfb` + a browser (Firefox or Chrome),
*or* both. Both options work on headless machines such as a CI or build server;
`xvfb` + a browser will pull in more libraries as dependencies than PhantomJS,
but will probably run quicker.

If you have installed Firefox extensions on a system-wide basis that interferes
with tests (e.g. `xul-ext-noscript`), you can set `PATH="$PWD/contrib:$PATH"`
to work around that.

To install PhantomJS 2, you have several options:

- Custom install, for all platforms: `npm install phantomjs2-ext`. You will
  need to `export PHANTOMJS_BIN="$PWD/node_modules/phantomjs2-ext/bin/phantomjs"`
  before running tests.
- System install, for Mac OS X: `brew install phantomjs`
- System install, for Debian/Ubuntu from around 2015-11: Add [this APT
  repo](https://people.debian.org/~infinity0/apt/), then run `apt-get update &&
  apt-get install phantomjs`. Note that this package misses features from the
  official package; but it should be enough to run this project's tests with.

## Building

To build this library, in the top-level repository directory run:

    $ make all

This will download dependencis from `npm`, run unit tests, build documentation,
build a dynamically-linked `mpenc.js` in the top-level repository directory, a
statically-linked `mpenc-static.js` in `build/`, and then run some basic tests
on both of these to make sure linking worked correctly.

See `Makefile` for more fine-grained targets to run. One target of interest is
`test-browser`, which keeps the browser open to watch changes you make to the
source files, and re-run affected tests automatically.

Both the static- and dynamically-linked forms may be loaded as a AMD module
(e.g. with RequireJS), a CommonJS module (e.g. in NodeJS), or directly using a
`<script>` tag in which case the entry point will be made accessible via the
global `mpenc` variable. The difference is that with the dynamic form, you also
need to load the other dependencies yourself - see `package.json` for details.
