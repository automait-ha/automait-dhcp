module.exports = init

var Emitter = require('events').EventEmitter
  , et = require('expect-telnet')
  , ping = require ('ping')

function init(callback) {
  callback(null, 'dhcp', Dhcp)
}

function Dhcp(automait, logger, config) {
  Emitter.call(this)
  this.automait = automait
  this.logger = logger
  this.config = config
  this.locations = setInitialLocations.call(this, this.config)
}

Dhcp.prototype = Object.create(Emitter.prototype)

Dhcp.prototype.init = function () {
  this.config.locations.forEach(function (location) {
    run.call(this, location.name, location.routerInfo)
  }.bind(this))
}

function run(locationName, routerInfo) {

  var people = {}
    , macToPerson = {}
    , macToTimeout = {}

  this.config.people.forEach(function (person) {
    macToPerson[person.macAddress] = person.name
    macToTimeout[person.macAddress] = person.timeout
    people[person.name] = { lastSeen: null }
  })

  execute.call(this)
  setInterval(execute.bind(this), 5000)

  function execute() {
    et(routerInfo.telnetIp + ':' + routerInfo.telnetPort
    , [ { expect: routerInfo.usernamePrompt, send: routerInfo.username + '\r' }
      , { expect: routerInfo.passwordPrompt, send: routerInfo.password + '\r' }
      , { expect: '#', send: 'arp -a\r' }
      , { expect: '#', out: parseOutput.bind(this), send: 'exit\r' }
      ]
    , function(error) {
        if (error) this.logger.error(error)
      }.bind(this)
    )
  }

  function parseOutput(output) {
    var lines = output.split('\n')
      , macAddresses = []
      , macsToIps = {}

    lines.forEach(function (line) {
      var parts = line.split(' ')
        , ip = parts[1].replace('(', '').replace(')', '')
        , mac = parts[3]

      macAddresses.push(mac)
      macsToIps[mac] = ip
    })

    var toFind = Object.keys(macToPerson)
    toFind.forEach(function (deviceId) {
      var isAtLocation = this.locations[locationName][macToPerson[deviceId]]
        , lastSeen = people[macToPerson[deviceId]].lastSeen
        , found = macAddresses.indexOf(deviceId) > -1
        , timeout = macToTimeout[deviceId] || 600000
        , macHandled = determineLeaving.call(this, found, isAtLocation, lastSeen, deviceId, timeout, 'no mac found')

      if (!macHandled && found) {
        var ip = macsToIps[deviceId]
        ping.sys.probe(ip, function (isAlive) {
          if (lastSeen && isAlive) {
            people[macToPerson[deviceId]].lastSeen = null
          }
          var ipHandled =
            determineLeaving.call(this, isAlive, isAtLocation, lastSeen, deviceId, timeout, 'no ping response')

          if (!ipHandled && !isAtLocation && isAlive) {
            this.locations[locationName][macToPerson[deviceId]] = true
            this.logger.info((new Date()).toString(), macToPerson[deviceId], 'reachable...')
            var eventName = 'location:' + locationName + ':person:' + macToPerson[deviceId] + ':reachable'
            this.emit(eventName, this.locations)
          }
        }.bind(this))
      }
    }.bind(this))
  }

  function determineLeaving(found, isAtLocation, lastSeen, deviceId, timeout, reason) {
    var now = (new Date()).getTime()
    if (!found && isAtLocation && !lastSeen) {
      people[macToPerson[deviceId]].lastSeen = now
      return true
    } else if (!found && isAtLocation && lastSeen && now - lastSeen >= timeout) {
      people[macToPerson[deviceId]].lastSeen = null
      this.locations[locationName][macToPerson[deviceId]] = false
      this.logger.info(macToPerson[deviceId], 'unreachable...(' + reason + ')')
      var eventName = 'location:' + locationName + ':person:' + macToPerson[deviceId] + ':unreachable'
      this.emit(eventName, this.locations)
      return true
    }
    return false
  }

}

function setInitialLocations(config) {
  var locations = {}
  config.locations.forEach(function (location) {
    var data = {}
    config.people.forEach(function (person) {
      data[person] = false
    })
    locations[location.name] = data
  })
  return locations
}
