const mongoose = require('mongoose')
const Schema = mongoose.Schema

const UserSchema = new Schema({
  chatId: {
    type: String,
    required: true
  },
  timezone: {
    type: String,
    required: true
  },
  timetable: {
    type: [Object],
    required: true,
    default: []
  }
})

mongoose.model('users', UserSchema)