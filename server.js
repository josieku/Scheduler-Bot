const { RTMClient, WebClient } = require('@slack/client')
const teamId = 'sjs-2018'
const token = process.env.BOT_USER_OAUTH_ACCESS_TOKEN
let axios = require('axios');
const express = require('express')
const app = express()
const bodyParser = require('body-parser')
const dialogflow = require('dialogflow')
const routingUrl = 'https://2d0f7e15.ngrok.io'
const slackTeam = 'sjs-2018'
const port = 1337

const BOT_ID = "UBV5QQP6G";
// models
const User = require('./models').User

const scheduleBotChannel = 'DBWNA5TCN'
const web = new WebClient(token);

// gCal api setup
const {google} = require('googleapis')
const {scopes, makeCalendarAPICall} = require('./cal')

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.DOMAIN + '/google/callback'
)

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))

// dialogflow session setup
const projectId = process.env.DIALOGFLOW_PROJECT_ID //https://dialogflow.com/docs/agents#settings
const sessionId = 'quickstart-session-id'
const sessionClient = new dialogflow.SessionsClient()
const sessionPath = sessionClient.sessionPath(projectId, sessionId)


const rtm = new RTMClient(token)
rtm.start()

rtm.on('message', event => {

  // console.log(event);
  const message = event.text
  const slackId = event.user
  User.findOne({slackId: slackId})
    .then(user => {
      /** Check that the user has not been authenticated AND we're not responding to a BOT's message **/
      if ((!user || !user.access_token) && !event.bot_id && event.user !== 'UBV5QQP6G') {
        /* send link to user so that they can authenticate */
        rtm.sendMessage(routingUrl + '/google/calendar?slackId=' + slackId, event.channel)

        /* The user is authenticated and it's not a BOT */
    } else if (!event.bot_id && event.user !== 'UBV5QQP6G'){

      // user already exists: send query to Api.ai
        const request = {
          session: sessionPath,
          queryInput: {
            text: {
              text: message,
              languageCode: 'en-US'
            }
          }
        }
        sessionClient
          .detectIntent(request)
          .then(responses => {
            const result = responses[0].queryResult
            //final confirmation of event

            if (result.action !== 'input.welcome' && result.allRequiredParamsPresent
                  // && result.parameters.fields.subject.stringValue && result.parameters.fields.date.stringValue
                ){
              web.chat.postMessage(generateMessage(result, event.channel));
            } else{
              // web.chat.postMessage(result.fulfillmentText);
              rtm.sendMessage(result.fulfillmentText, event.channel)
            }

            if (result.intent) {
              // console.log(`  Intent: ${result.intent.displayName}`)
            } else {
              // console.log(`  No intent matched.`)
            }
          }).then(msg => console.log('message sent')
          )
      }
    })
})

function generateMessage(result, channel){

  let action = ""
  let date = "";
  let subject = "";
  let time = "";
  let invitees = "";
  let url="";

  if (result.intent.displayName === "remind"){

    subject = result.parameters.fields.subject.stringValue;
    date = new Date(result.parameters.fields.date.stringValue);
    action = `Reminder to ${subject} on ${date.toDateString()}`;
    // url = `http://localhost:1337/yesRoute?`
    url = `${routingUrl}/google/addEvent?subject=${subject}&date=${date}&slackId=${slackId}&channel=${channel}`;
    // ?subject=${subject}&date=${date}&channel=${channel}`

  } else if (result.intent.displayName === "scheduler"){
    date = new Date(result.parameters.fields.date.stringValue);
    time = new Date(result.parameters.fields.time.stringValue).toTimeString();
    invitees = result.parameters.fields.invitees.listValue.values.map(p=> p.stringValue);
    action = `A meeting is scheduled on ${date.toDateString()} at ${time} with ${invitees.map(p=> p.stringValue)}`;
    url = `${routingUrl}/google/addEvent?date=${date}&time=${time}&invitees=${invitees}&slackId=${slackId}&channel=${channel}`;
  }
  return {
      "text": "Would you like to add this to your calendar?",
      "channel": channel,
      "token": token,
      "attachments": [
          {
              "text": action,
              "fallback": "Shame... buttons aren't supported in this land",
              "callback_id": "button_tutorial",
              "color": "#3AA3E3",
              "attachment_type": "default",
              "actions": [
                  {
                      "name": "yes",
                      "text": "yes",
                      "type": "button",
                      "value": "yes",
                      "url": url
                      // "url": `${routingUrl}/google/addEvent?subject=${subject}&date=${date}&slackId=${slackId}`
                  },
                  {
                      "name": "no",
                      "text": "no",
                      "type": "button",
                      "value": "no"
                  }
              ]
          }
      ]
  };
}

app.get('/yesRoute', (req, res)=> {
  console.log('123456789', req.query.subject, req.query.date, req.query.channel);
  web.chat.postMessage({
    "text": "Added this to your calendar",
    "channel": req.query.channel,
    "token": token,
  })
  res.redirect(`https://${slackTeam}.slack.com/messages/${req.query.channel}/`);
})

/* GOOGLE API ROUTES */
// GET route that redirects to google oatuh2 url
app.get('/google/calendar', function (req, res) {
  console.log('get google calendar route')
  // TODO: get slackId, task, and action from slack
  let slackId = req.query.slackId || 'myslackId'
  // save action into database?

  // check if user exists
  User.findOne({
    slackId: slackId
  })
    .exec()
    .then((user) => {
      if (!user && user !== BOT_ID) {
      // create a new user in database
        var newUser = new User({
          slackId: slackId
        })
        newUser.save()
          .then((user) => {
            // generate a url that asks permissions for Google+ and Google Calendar scopes
            var url = oauth2Client.generateAuthUrl({
            // 'online' (default) or 'offline' (gets refresh_token)
              access_type: 'online',
              // refresh_token only returned on the first authorization
              scope: scopes,
              state: encodeURIComponent(JSON.stringify({
                auth_id: user._id
              })),
              prompt: 'consent'
            })
            res.redirect(url)
          })
          .catch((err) => {
            console.log('error', err)
            res.status(500).send('internal error')
          })
      } else {
        // check access token
        if (!user.access_token) {
          // user exists but failed to authenticate
          var url = oauth2Client.generateAuthUrl({
            // 'online' (default) or 'offline' (gets refresh_token)
            access_type: 'online',
            // refresh_token only returned on the first authorization
            scope: scopes,
            state: encodeURIComponent(JSON.stringify({
              auth_id: user._id
            })),
            prompt: 'consent'
          })
          res.redirect(url)
        } else {
          // user exists and is authenticated - shouldn't be here
          console.log('why are you here???')
          res.status(500).send('server error')
        }
      }
    })
    .catch((err) => {
      console.log('error finding user', err)
      res.status(500).send('internal server error')
    })
})

// GET route that handles oauth callback for google api
app.get('/google/callback', function (req, res) {
  var code = req.query.code
  // This will provide an object with the access_token and refresh_token
  oauth2Client.getToken(code, (err, tokens) => {
    console.log('token!!', tokens)
    if (err) return console.log('!!error:', err)
    oauth2Client.setCredentials(tokens)

    // look for user based on auth_id and store token in database
    var auth_id = JSON.parse(decodeURIComponent(req.query.state)).auth_id
    console.log('auth_id!!!', auth_id)
    User.findById(auth_id)
      .exec()
      .then((user) => {
        if (!user) {
          console.log('user not found')
          res.status(500).send('database error')
        } else {
          user.access_token = tokens.access_token
          user.refresh_token = tokens.refresh_token
          user.save()
          res.status(200).send('Successfully authenticated. You may now go back to Slack to send the message again')
        }
      })
      .catch((err) => {
        console.log('errorrrr', err)
        res.status(500).send('internal error')
      })
    })
  })

app.listen(port || process.env.PORT)
