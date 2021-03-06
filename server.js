// Newrelic *must* be the first module loaded. Do not move this require module!
if ( process.env.NEW_RELIC_HOME ) {
  require( 'newrelic' );
}

var express = require('express'),
    path = require('path'),
    helmet = require( "helmet" ),
    nunjucks = require('nunjucks'),
    nunjucksEnv = new nunjucks.Environment(new nunjucks.FileSystemLoader( __dirname + '/views' )),
    app = express(),
    lessMiddleware = require( 'less-middleware' ),
    requirejsMiddleware = require( 'requirejs-middleware' ),
    config = require( './lib/config' ),
    Project,
    filter,
    sanitizer = require( './lib/sanitizer' ),
    metrics = require('./lib/metrics.js'),
    middleware,
    APP_HOSTNAME = config.hostname,
    WWW_ROOT =  __dirname + '/public';

nunjucksEnv.express( app );

app.locals({
  config: {
    app_hostname: APP_HOSTNAME,
    audience: config.AUDIENCE,
    ga_account: config.GA_ACCOUNT,
    ga_domain: config.GA_DOMAIN,
    make_endpoint: config.MAKE_ENDPOINT,
    user_bar: config.USER_BAR
  }
});

app.configure( function() {
  var tmpDir = path.normalize( require( "os" ).tmpDir() + "/mozilla.butter/" );

  app.use( express.logger( config.logger ) );
  if ( !!config.FORCE_SSL ) {
    app.use( helmet.hsts() );
    app.enable( "trust proxy" );
  }
  app.use( express.compress() )
    .use( lessMiddleware({
      once: config.OPTIMIZE_CSS,
      dest: tmpDir,
      src: WWW_ROOT,
      compress: config.OPTIMIZE_CSS,
      yuicompress: config.OPTIMIZE_CSS,
      optimization: config.OPTIMIZE_CSS ? 0 : 2
    }))
    .use( requirejsMiddleware({
      src: WWW_ROOT,
      dest: tmpDir,
      once: config.OPTIMIZE_JS,
      modules: {
        "/src/butter.js": {
          include: [ "butter" ],
          mainConfigFile: WWW_ROOT + "/src/popcorn.js",
          paths: {
            "make-api": path.resolve( __dirname, "node_modules/makeapi-client/src/make-api" ),
            "sso-include": path.resolve( __dirname, "node_modules/webmaker-sso/include" )
          }
        },
        "/src/embed.js": {
          include: [ "embed" ],
          mainConfigFile: WWW_ROOT + "/src/popcorn.js",
        },
        "/templates/assets/editors/editorhelper.js": {
          include: [ "../templates/assets/editors/editorhelper" ],
          mainConfigFile: WWW_ROOT + "/src/popcorn.js"
        }
      },
      defaults: {
        baseUrl: WWW_ROOT + "/src/",
        findNestedDependencies: true,
        optimize: "none",
        preserveLicenseComments: false,
        wrap: {
          startFile: __dirname + "/tools/wrap.start",
          endFile: __dirname + "/tools/wrap.end"
        }
      }
    }))
    .use( express.static( tmpDir, JSON.parse( JSON.stringify( config.staticMiddleware ) ) ) )
    .use( express.static( WWW_ROOT, JSON.parse( JSON.stringify( config.staticMiddleware ) ) ) );

  app.use( express.bodyParser() )
    .use( express.cookieParser() )
    .use( express.cookieSession( config.session ) )
    .use( express.csrf() )
    .use( helmet.xframe() )
    /* Show Zeus who's boss
     * This only affects requests under /api and /persona, not static files
     * because the static file writes the response header before we hit this middleware
     */
    .use( function( req, res, next ) {
      res.header( 'Cache-Control', 'no-store' );
      return next();
    })
    .use( app.router )
    .use( function( err, req, res, next) {
      if ( !err.status ) {
        err.status = 500;
      }

      middleware.errorHandler( err, req, res );
    })
    .use( function( req, res, next ) {
      var err = {
        message: "This page doesn't exist",
        status: 404
      };

      middleware.errorHandler( err, req, res );
    });

  Project = require( './lib/project' )( config.database );
  filter = require( './lib/filter' )( Project.isDBOnline );
});

require( './lib/loginapi' )( app, {
  audience: config.AUDIENCE,
  loginURL: config.LOGIN_SERVER_URL_WITH_AUTH
});

middleware = require( './lib/middleware' );

var routes = require('./routes');

app.param( "myproject", middleware.loadOwnProject( Project ));
app.param( "anyproject", middleware.loadAnyProject( Project ));

app.post( '/api/publish/:myproject',
  filter.isLoggedIn, filter.isStorageAvailable,
  routes.api.publish
);

app.get( '/dashboard', function( req, res ) {
  res.redirect( config.AUDIENCE + "/me?app=popcorn" );
});

app.get( '/', routes.pages.editor );
app.get( '/index.html', routes.pages.editor );
app.get( '/editor', routes.pages.editor );
app.get( '/editor/:id', routes.pages.editor );
app.get( '/editor/:id/edit', routes.pages.editor );
app.get( '/editor/:id/remix', routes.pages.editor );
app.get( '/templates/basic', routes.pages.editor );
app.get( '/templates/basic/index.html', routes.pages.editor );

app.get( '/external/make-api.js', function( req, res ) {
  res.sendfile( path.resolve( __dirname, "node_modules/makeapi-client/src/make-api.js" ) );
});
app.get( '/external/sso-include.js', function( req, res ) {
  res.sendfile( path.resolve( __dirname, "node_modules/webmaker-sso/include.js" ) );
});

// Project Endpoints
app.post( '/api/project/:id?',
  filter.isLoggedIn,
  filter.isStorageAvailable,
  routes.api.synchronize( Project ),
  middleware.synchronizeMake,
  function( req, res ) {
    res.json( { error: 'okay', project: req.project } );
});
//app.post( '/api/delete/:myproject?', filter.isLoggedIn, filter.isStorageAvailable, routes.api.remove, middleware.removeMake, function( req, res ) {
  // res.json( { error: 'okay' }, 200 );
//});
app.get( '/api/remix/:anyproject', filter.isStorageAvailable, routes.api.remix, middleware.finalizeProjectResponse( Project ) );
app.get( '/api/project/:myproject', filter.isLoggedIn, filter.isStorageAvailable, routes.api.find, middleware.finalizeProjectResponse( Project ) );

// Firehose Endpoints
//app.get( '/api/project/:id/remixes', filter.isStorageAvailable, filter.crossOriginAccessible, routes.firehose.remixes );
//app.get( '/api/projects/recentlyUpdated/:limit?', filter.isStorageAvailable, filter.crossOriginAccessible, routes.firehose.recentlyUpdated );
//app.get( '/api/projects/recentlyCreated/:limit?', filter.isStorageAvailable, filter.crossOriginAccessible, //routes.firehose.recentlyCreated );
//app.get( '/api/projects/recentlyRemixed/:limit?', filter.isStorageAvailable, filter.crossOriginAccessible, routes.firehose.recentlyRemixed );

app.post( '/crash', routes.api.crash );
app.post( '/feedback', routes.api.feedback );

app.get( '/healthcheck', routes.api.healthcheck );

app.get( '/api/butterconfig', function( req, res ) {
  res.json({
    "audience": app.locals.config.audience,
    "make_endpoint": app.locals.config.make_endpoint,
    "user_bar": app.locals.config.user_bar
  });
});

app.put( "/api/image", filter.isImage, routes.api.image );

app.listen( config.PORT, function() {
  console.log( 'HTTP Server started on ' + APP_HOSTNAME );
  console.log( 'Press Ctrl+C to stop' );
});
