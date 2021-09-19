// ====== REQUIRES ======
const TelegramBot = require('node-telegram-bot-api') // telegram bot library
const mongoose = require('mongoose') // mongodb library
const schedule = require('node-schedule') // time library https://www.npmjs.com/package/node-schedule - desc and docs

const searchInTimezones = require('./timezone_database')

require('dotenv').config() // .env
require('./models/user.model') // user model for db



// ====== DB ======
// === MONGO DB ===
const DB_URL = process.env.DATABASE_URL
mongoose.Promise = global.Promise

async function connectToMongo() {
  await mongoose.connect(DB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }).then(() => {
    console.log('Mongoose connected')
  }).catch(err => {
    console.log(err)
  })
}
connectToMongo().then(() => console.log('MongoDB connected'))

// const db = require('./database.json')
const User = mongoose.model('users')
// db.users.forEach(f => new User(f).save())



// ====== BOT ======
// === DEFAULT START OF TELEGRAM BOT API ===
const TOKEN = process.env.BOT_TOKEN
const bot = new TelegramBot(TOKEN, {polling: true})


// === VARS ===
let chatId // chatId. setting in bot.on . global for schedule
let timetable = [] // arr with obj of businesses. ex. {text: 'eat', time: '16:00', repeat: 'Every day'/'Weekdays'/'No repeat'}

let list // simple version of timetable for sending it by bot (list.join('\n'))
const resetList = (timetable) => {
  timetable.sort((a, b) => {
    return a.time.slice(0, 2) - b.time.slice(0, 2)
  })

  list = timetable.map((e, i) => {
    return ++i + ': ' + e.text + ' , ' + e.time + ' , ' + e.repeat
  })
}
resetList(timetable) // run this function every timetable change


// === SET TIME ===
let job // lib var here, for canceling reminder in all code
let tz // timezone. setting in /start and /setnewtimezone

const setSchedule = async (timetable, chatId, tz) => {
  timetable.forEach(business => {
    let rule

    switch (business.repeat) {
      case 'Every day':
        rule = new schedule.RecurrenceRule()
        rule.tz = tz
        rule.hour = business.time.slice(0, 2) === '00' ? 0 : Number(business.time.slice(0, 2))
        rule.minute = Number(business.time.slice(3, 5))

        job = schedule.scheduleJob(rule, function () {
          bot.sendMessage(chatId, business.text)
        })

        break

      case 'Weekdays':
        rule = new schedule.RecurrenceRule()
        rule.tz = tz
        rule.dayOfWeek = [new schedule.Range(1, 5)];
        rule.hour = business.time.slice(0, 2) === '00' ? 0 : Number(business.time.slice(0, 2))
        rule.minute = Number(business.time.slice(3, 5))

        job = schedule.scheduleJob(rule, function () {
          bot.sendMessage(chatId, business.text)
        })

        break

      case 'No repeat':
        rule = new schedule.RecurrenceRule()
        rule.tz = tz
        rule.hour = business.time.slice(0, 2) === '00' ? 0 : Number(business.time.slice(0, 2))
        rule.minute = Number(business.time.slice(3, 5))

        job = schedule.scheduleJob(rule, function () {
          bot.sendMessage(chatId, business.text)

          // deleting this business from timetable, reseting list and setting schedule again, cause of 'No repeat'
          deleteBusinessFromTimetableDB({chatId: chatId}, timetable.indexOf(business))
          setSchedule(timetable, chatId, tz)
        })

        break
    }
  })
}


// === COMMANDS ===
const start = () => {
  bot.setMyCommands([
    {command: '/start', description: 'Starting bot'},
    {command: '/setnewtimezone', description: 'Set new timezone'},
    {command: '/mylist', description: 'Show list of your business'},
    {command: '/addbusiness', description: 'Add business to a list'},
    {command: '/deletebusiness', description: 'Delete business from list'},
  ]).then(() => 'Commands setted')

  bot.on('message', async msg => {
    chatId = msg.chat.id
    queryForDB = {chatId: chatId}

    const command = msg.text.split(' ')[0]
    switch (command) {
      case '/start': // just start command
        await getDataFromDBByChatId(queryForDB, chatId)

        await bot.sendMessage(chatId, 'Hello, my name is Daily Bot. I am your daily helper. You make a to-do list and then every day I remind you of your business')
        await bot.sendMessage(chatId, 'At FIRST. I need your city for correctly time working. You don\'t want a message at 3:00 of night right?',

          createAKeyboard(false,[
            'FOR EXAMPLE:',
            'Bishkek',
            'Moscow',
            'Kiev',
            'Tokyo'
          ]))
          .then(() => {
            status = SETTING_TIMEZONE
          })
        break
      case '/setnewtimezone': // set new tz
        await getDataFromDBByChatId(queryForDB, chatId)

        await bot.sendMessage(chatId, 'Your current timezone is ' + `${tz}\n` +
          'Type your new city to change it',

          createAKeyboard(false,[
            'FOR EXAMPLE:',
            'Bishkek',
            'Moscow',
            'Kiev',
            'Tokyo'
          ]))
          .then(() => {
            status = SETTING_TIMEZONE
          })
        break
      case '/mylist': // show list of businesses
        await getDataFromDBByChatId(queryForDB, chatId)

        await bot.sendMessage(chatId, 'Your list')
        if (list.length > 0) {
          await bot.sendMessage(chatId, list.join('\n'))
        } else {
          await bot.sendMessage(chatId, 'You have nothing in your list')
        }

        break
      case '/addbusiness': // add business to a list
        await getDataFromDBByChatId(queryForDB, chatId)

        await bot.sendMessage(chatId, 'Okay. What *business*, \n*time* (24 hours format only) and when i need to \n*repeat* it (1: Every day, 2: Weekdays, 3: No repeat)?',
          createAKeyboard(true, ['FOR EXAMPLE', 'Eat, 13:00, 1', 'Toilet, 14:00, 2', 'Die, 0:00, 3']))
          .then(() => {
            status = ADDING_BUSINESS
          })
        break
      case '/deletebusiness': // delete business from list
        await getDataFromDBByChatId(queryForDB, chatId)

        await bot.sendMessage(chatId, 'Sure. Which one?', createAKeyboard(true, [...list.map((e,i) => `${i + 1}`), 'Cancel']))
          .then(() => {
            status = DELETING_BUSINESS
          })
        timetable.length !== 0 ? await bot.sendMessage(chatId, list.join('\n')) : await bot.sendMessage(chatId, 'You have nothing in your list')
        break
      default: // all messages which do not start with '/'
        switch (status) {
          case SETTING_TIMEZONE: // /start and /settimezone
            if (searchInTimezones(msg.text) !== undefined) {
              await setTimezoneInDB(queryForDB, searchInTimezones(msg.text))
              status = ''
              return bot.sendMessage(chatId, 'Done. If it is wrong just change it with /setnewtimezone function', {reply_markup: JSON.stringify({remove_keyboard: true})})
            } else {
              return await bot.sendMessage(chatId, 'Wrong. Make sure you are writing your timezone correctly')
            }
          case ADDING_BUSINESS: // /addbusiness
            if (/\s*\w+\s*,\s*([01][0-9]|2*[0-3]):([0-5][0-9])\s*,\s*[1-3]\s*/g.test(msg.text)) {
              await addBusinessToTimetableDB(queryForDB, msg.text)
              status = ''
              return bot.sendMessage(chatId, 'Done. Check /mylist', {reply_markup: JSON.stringify({remove_keyboard: true})})
            } else {
              return await bot.sendMessage(chatId, 'Wrong. Look on examples of business again')
            }
          case DELETING_BUSINESS: // /deletebusiness
            if (timetable[msg.text - 1] !== undefined) {
              await deleteBusinessFromTimetableDB({chatId: chatId}, msg.text - 1)
              status = ''
              return bot.sendMessage(chatId, 'Done. Check /mylist', {reply_markup: JSON.stringify({remove_keyboard: true})})
            } else if (msg.text === 'Cancel') {
              return bot.sendMessage(chatId, 'Okay. Check /mylist', {reply_markup: JSON.stringify({remove_keyboard: true})})
            } else {
              return await bot.sendMessage(chatId, 'Wrong. Look on examples of business again')
            }
          default:
            return await bot.sendMessage(chatId, 'I don\'t know what you are talking about')
        }
    }

    if (job !== undefined) {
      let jobs = schedule.scheduledJobs
      for (let j in jobs) schedule.cancelJob(j) // canceling prev reminder
    }
    await restartScheduleForAllUsers() // and setting new reminder on every message
  })
}


// === START THE BOT ===
start()
bot.on('polling_error', (error) => console.log(error)) // log error on polling error


// === FUNCTION WHEN HEROKU RESTART`S ===
async function restartScheduleForAllUsers() {
  await User.find({}).then(users => {
    users.forEach(user => {
      if (user.timezone.length !== 0) {
        setSchedule(user.timetable, user.chatId, user.timezone)
      }
    })
  })
}
restartScheduleForAllUsers().then(() => console.log('Schedules restarted')) // when heroku restart`s it is clearing schedule. so after restarting we iterate threw all users and set schedule back



// ====== Vars and Functions for working default messages (with information we getting form user) ======
let status // status what we need to get right now
const SETTING_TIMEZONE = 'SETTING_TIMEZONE' // set in /start and /settimezone
const ADDING_BUSINESS = 'ADDING_BUSINESS' // set in /addbusiness
const DELETING_BUSINESS = 'DELETING_BUSINESS' // set in /deletebusiness

function createAKeyboard(isParseMode,keyboard) {
  let res = {
    reply_markup: JSON.stringify({
      keyboard: [keyboard],
      resize_keyboard: true,
      one_time_keyboard: true
    })
  }

  if (isParseMode) {
    res.parse_mode = 'markdown'
  }

  return res
}



// ====== Functions for working with DB ======
let queryForDB // i am tired of copy past that thing (define in start bot)

async function getDataFromDBByChatId(query, chatId) {
  await User.findOne(query).then(async user => {
    if (user !== null) {
      tz = user.timezone

      timetable = user.timetable
      resetList(timetable)
    } else {
      tz = ''
      timetable = []
      list = []

      let newUser = new User({
        chatId: chatId,
        timezone: 'Asia/Bishkek',
        timetable: []
      })
      await newUser.save().then(() => console.log('User created'))

      await getDataFromDBByChatId(queryForDB, chatId)
    }
  }).catch(err => console.log(err))
}

async function addBusinessToTimetableDB(query, business) {
  await User.findOne(query).then(user => {
    if (user !== undefined) {
      let arr = business.split(',')
      arr = arr.map(e => e.trim())
      let text = arr[0],
          time = arr[1],
          repeat

      switch (arr[2]) {
        case '1':
          repeat = 'Every day'
          break;
        case '2':
          repeat = 'Weekdays'
          break;
        case '3':
          repeat = 'No repeat'
          break;
      }

      user.timetable.push({text: text, time: time, repeat: repeat})
      user.save()

      timetable = user.timetable
      resetList(timetable)
    } else {
      console.log('User not found')
    }
  }).catch(err => console.log(err))
}

async function deleteBusinessFromTimetableDB(query, i) {
  await User.findOne(query).then(user => {
    if (user !== undefined) {
      user.timetable.splice(i, 1)
      user.save()

      timetable = user.timetable
      resetList(timetable)
    } else {
      console.log('User not found')
    }
  }).catch(err => console.log(err))
}

async function setTimezoneInDB(query, newTz) {
  await User.findOne(query).then(user => {
    if (user !== undefined) {
      user.timezone = newTz
      user.save()

      tz = user.timezone
    } else {
      console.log('User not found')
    }
  }).catch(err => console.log(err))
}