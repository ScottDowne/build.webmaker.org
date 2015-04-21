/**
 * HTTP server for build.webmaker.org
 *
 * @package build
 * @author  David Ascher <davida@mozillafoundation.org>
 *          Andrew Sliwinski <a@mozillafoundation.org>
 */

var express = require('express');
var cookieParser = require('cookie-parser');
var compress = require('compression');
var bodyParser = require('body-parser');
var logger = require('morgan');
var errorHandler = require('errorhandler');

var sessions = require('client-sessions');
var flash = require('express-flash');
var path = require('path');
var cors = require('cors');
var expressValidator = require('express-validator');
var issueParser = require('./server/issueparser.js');
var processHook = issueParser.processHook;
var request = require( "request" );
var cache = require( "./lib/cache" );

/**
 * Import API keys from environment
 */
var secrets = require('./server/config/secrets');

/**
 * Github handlers
 */
var Github = require('./server/models/github');
var github = new Github(secrets.github);

/**
 * Create Express server.
 */
var app = express();

/**
 * Controllers (route handlers).
 */
var routes = require( "./routes" )();

/**
 * Express configuration.
 */
app.set('port', process.env.PORT || 8080);
app.set('github_org', 'MozillaFoundation');
app.set('github_repo', 'plan');

app.use(sessions({
  cookieName: 'session',
  secret: secrets.sessionSecret,
  duration: 24 * 60 * 60 * 1000,
  activeDuration: 1000 * 60 * 5
}));
app.use(compress()); // Note: this messes up JSON view in firefox dev tools
app.use(express.static(
  path.join(__dirname, './app/public'), { maxAge: 1000 * 3600 * 24 * 365.25 })
);
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(expressValidator());
app.use(cookieParser());
app.use(flash());
app.use(cors());
app.use(github.middleware);

/**
 * Controllers (route handlers).
 */
var routes = {
  schedule: require('./server/controllers/schedule'),
  issues: require('./server/controllers/issues')
};

/**
 * Main routes.
 */
app.post('/api/add', routes.schedule.createPost);
app.get('/api/now', routes.schedule.now);
app.get('/api/next', routes.schedule.next);
app.get('/api/upcoming', routes.schedule.upcoming);
app.get('/api/team/:team', function(req, res) {
  github.teamMembers(req.params.team, function(err, body) {
    if (err) res.redirect('/500');
    res.type('application/json; charset=utf-8').send(body);
  });
});
app.get('/api/github/search/issues', function(req, res) {
  var sort = req.query.sort || 'updated';
  var order = req.query.order || 'asc';
  github.search(req.query.q, sort, order, function(err, body) {
    if (err) res.redirect('/500');
    res.type('application/json; charset=utf-8').send(body);
    // res.type('application/json').send(body);
  });
});
app.get('/api/user/:username', function(req, res) {
  github.getUserInfo(req.params.username, function(err, body) {
    if (err) res.redirect('/500');
    res.type('application/json').send(body);
  });
});
app.get('/api/myissues/assigned', routes.issues.myAssigned);
app.get('/api/myissues/subscribed', routes.issues.mySubscribed);
app.get('/api/myissues/mentioned', routes.issues.myMentioned);
app.get('/api/myissues/created', routes.issues.myCreated);

function oauthCB(req, res, path) {
  var oauth = require('github-oauth')({
    githubClient: secrets.github.clientID,
    githubSecret: secrets.github.clientSecret,
    baseURL: secrets.github.host,
    callbackURI: secrets.github.callbackURL + '/' + path,
    loginURI: '/login',
    scope: 'public_repo' // we need this to be able to create issues.
  });
  oauth.login(req, res);
}

app.get('/auth/github/:path', function(req, res) {
  oauthCB(req, res, req.params.path);
});
app.get('/auth/github', function(req, res) {
  oauthCB(req, res, '');
});

function processCallback(req, res, path) {
  var oauth = require('github-oauth')({
    githubClient: secrets.github.clientID,
    githubSecret: secrets.github.clientSecret,
    baseURL: secrets.github.host,
    callbackURI: secrets.github.callbackURL + path,
    loginURI: '/login',
    scope: ''
  });
  oauth.callback(req, res, function (err, body) {
    if (err) {
      req.flash('errors', {msg: err});
    } else {
      req.session.token = body.access_token;
      // Get User information, and send it in a cookie
      github.getUserFromToken(body.access_token, function(err, body) {
        if (!err) {
          // For some reason, this results in a cookie w/ "j$3A" at the front, which confuses me:
          //     "github=j%3A%7B%22body%22%3A%7B%22login... ....qTKzGvAWm5ElZZ9PwUtZs4FAyDkOPtno9480FIX1P0A; path=/; expires=Mon, 02 Feb 2015 19:32:02 GMT; httponly"
          res.cookie('github', body, { maxAge: 900000 });

          // res.redirect("/#/"+path); // Remove this when we move away from # URLs
          res.redirect('/'+path); // Remove this when we move away from # URLs
        }
      });
    }
  });
}
app.get('/auth/callback/:path', function (req, res) {
  processCallback(req, res, req.params.path);
});
app.get('/auth/callback', function (req, res) {
  processCallback(req, res, '');
});


app.post('/postreceive', processHook);


app.get('/logout', function (req, res) {
  req.session.token = null;
  res.redirect('/');
});

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, './app/public/index.html'));
});
app.get('/add', function(req, res) {
  res.sendFile(path.join(__dirname, './app/public/index.html'));
});
app.get('/next', function(req, res) {
  res.sendFile(path.join(__dirname, './app/public/index.html'));
});
app.get('/now', function(req, res) {
  res.sendFile(path.join(__dirname, './app/public/index.html'));
});
app.get('/upcoming', function(req, res) {
  res.sendFile(path.join(__dirname, './app/public/index.html'));
});
app.get('/design', function(req, res) {
  res.sendFile(path.join(__dirname, './app/public/index.html'));
});
app.get('/audience', function(req, res) {
  res.sendFile(path.join(__dirname, './app/public/index.html'));
});
app.get('/dashboards', function(req, res) {
  res.sendFile(path.join(__dirname, './app/public/index.html'));
});
app.get('/myissues', function(req, res) {
  res.sendFile(path.join(__dirname, './app/public/index.html'));
});
app.get('/bugs', function(req, res) {
  res.sendFile(path.join(__dirname, './app/public/index.html'));
});
app.get('/issues', function(req, res) {
  res.sendFile(path.join(__dirname, './app/public/index.html'));
});

// Cache check middleware: if the URL is in cache, use that.
function checkCache( req, res, next ) {
  if ( checkCache.overrides[ req.url ] ) {
    delete checkCache.overrides[ req.url ];
    next();
    return;
  }
  cache.read( req.url, function( err, data ) {
    if ( err || !data ) {
      next( err );
      return;
    }
    res.json( data );
  });
}
checkCache.overrides = {};

var mozillaRepos = "id.webmaker.org webmaker-curriculum snippets teach.webmaker.org goggles.webmaker.org webmaker-tests sawmill login.webmaker.org openbadges-badgekit webmaker-app api.webmaker.org popcorn.webmaker.org webmaker-mediasync webmaker.org webmaker-app-cordova webmaker-metrics nimble mozilla-opennews teach-api mozillafestival.org call-congress-net-neutrality thimble.webmaker.org advocacy.mozilla.org privacybadges webmaker-profile-2 call-congress build.webmaker.org webmaker-landing-pages webliteracymap events.webmaker.org badgekit-api openbadges-specification make-valet webmaker-auth webmaker-events-service webmaker-language-picker MakeAPI blog.webmaker.org webmaker-login-ux webmaker-desktop webmaker-app-publisher badges.mozilla.org lumberyard webmaker-download-locales webmaker-addons bsd-forms-and-wrappers popcorn-js hivelearningnetworks.org webmaker-firehose makeapi-client makerstrap webmaker-app-bot webmaker-screenshot react-i18n webmaker-kits-builder webmaker-app-guide".split(" ");
var orgs = ["MozillaFoundation", "MozillaScience"];

app.get( "/api/github/mozilla-repo-names", checkCache, function(req, res) {
  // Get Foundation repos then merge them with a static list of mozilla repos.
  github.getRepos(orgs, function(err, results) {
    if (err) {
      // Not sure what to do with errors, yet.
      console.log(err);
    } else {
      var repoNames = [];
      results.forEach(function(repo) {
        repoNames.push(repo.full_name);
      });
      // Merge with static list of mozilla repos.
      res.json( repoNames.concat(mozillaRepos.map(function(item) {
        return "mozilla/" + item;
      })));
    }
  });
});
app.get( "/api/github/foundation-users", checkCache, function(req, res) {
  github.getUsersForOrgs(orgs, function(err, results) {
    if (err) {
      // Not sure what to do with errors, yet.
      console.log(err);
    } else {
      res.json(results);
    }
  });
});
app.get( "/api/github/mozilla-labels", checkCache, function(req, res) {
  var url = "http://127.0.0.1:" + app.get('port') + "/api/github/mozilla-repo-names";
  request(url, function (error, response, body) {
    if (error) {
      console.log(error);
    } else if (!error && response.statusCode == 200) {
      var repos = JSON.parse(body);
      github.getLabelsForRepos(repos, function(err, results) {
        if (err) {
          // Not sure what to do with errors, yet.
          console.log(err);
        } else {
          res.json(results);
        }
      });
    }
  });
});
app.get( "/api/github/mozilla-milestones", checkCache, function(req, res) {
  var url = "http://127.0.0.1:" + app.get('port') + "/api/github/mozilla-repo-names";
  request(url, function (error, response, body) {
    if (error) {
      console.log(error);
    } else if (!error && response.statusCode == 200) {
      var repos = JSON.parse(body);
      github.getMilestonesForRepos(repos, function(err, results) {
        if (err) {
          // Not sure what to do with errors, yet.
          console.log(err);
        } else {
          res.json(results);
        }
      });
    }
  });
});
// To increase client-side performance, we prime the cache with data we'll need.
// Each resource (route URL) can specify a unique frequency for updates. If
// none is given, the cache expiration time is used.
function primeCache( urlPrefix ) {
  // { url: "url-for-route", frequency: update-period-in-ms }
  [
    { url: "/api/github/mozilla-repo-names" },
    { url: "/api/github/foundation-users" },
    { url: "/api/github/mozilla-labels" },
    { url: "/api/github/mozilla-milestones" }
  ].forEach( function( resource ) {
    var url = resource.url,
        frequency = resource.frequency || 60 * 60 * 1000; // Default: every hour

    function updateResource() {
      checkCache.overrides[ url ] = true;
      request.get( urlPrefix + url, function( err, resp, body ) {
        if ( err ) {
          return console.log( "Error updating cache entry for %s: %s", url, err );
        }
        cache.write( url, JSON.parse(body) );
      });
    }

    // Setup a timer to do this update, and also do one now
    updateResource();
    setInterval( updateResource, frequency ).unref();
  });
}

primeCache("http://127.0.0.1:" + app.get('port'));

/**
 * Webhook handler (from github)
 */
github.githubRequest({query:"rate_limit"}, function(err, data) {
  console.log("Github API requests left: " + data.rate.remaining);
});

/**
 * 500 Error Handler.
 */
app.use(errorHandler());

/**
 * Start Express server.
 */
app.listen(app.get('port'), function() {
  console.log('Server listening on port %d in %s mode', app.get('port'), app.get('env'));
});

module.exports = app;
