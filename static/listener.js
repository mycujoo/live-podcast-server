'use strict'

var audioContext = window.AudioContext || window.webkitAudioContext
var client
var context
var nextTime
var roomName

var startBtn = document.querySelector('#start-btn')
var stopBtn = document.querySelector('#stop-btn')

startBtn.addEventListener('click', function(e) {
    close()

    roomName = document.querySelector('#room-name').value

    client = Primus.connect('ws://' + location.host, {
        websockets: true,
        reconnect: {
            min: 2000,
            retries: 1000
        },
        transport: {
            binaryType: 'arraybuffer'
        }
    })

    client.on('open', function () {
        console.log('connection open')

        client.send('join', roomName)

        context = new audioContext()

        nextTime = 0
        var init = false
        var audioCache = []

        client.on('data', function (data) {
            var array = new Float32Array(data)
            var bufferSize = 1024
            var sampleRate = 44100
            var channelsNum = 1
            var buffer = context.createBuffer(channelsNum, bufferSize, sampleRate)

            buffer.copyToChannel(array, 0)

            audioCache.push(buffer)

            drawBuffer(array)

            // make sure we put at least 5 chunks in the buffer before starting
            if (init === true || (init === false && audioCache.length > 5)) {
                init = true

                playAudio(audioCache)
            }
        })

        client.on('close', function () {
            console.log('connection closed')
        })
    })
})

stopBtn.addEventListener('click', function() {
    if (client) {
        client.send('leave', roomName)
    }

    close()
})

function playAudio(cache) {
    while (cache.length) {
        var buffer = cache.shift()
        var source = context.createBufferSource()

        // buffering 5 chunks yields about 0.25 seconds
        // each buffer chunk duration is 0.05 seconds
        // and it allows for reasonably smooth playback
        var delay = 0.05

        source.buffer = buffer
        source.connect(context.destination)

        if (nextTime === 0) {
            // context.currentTime gives you the current time
            // as far as the audio context is concerned
            nextTime = context.currentTime + delay
        }

        source.start(nextTime)
        nextTime += source.buffer.duration
    }
}

function close(){
    console.log('close')

    if (client) client.end()
}

function drawBuffer(data) {
    var canvasElem = document.querySelector('#canvas')
    var width = canvasElem.width
    var height = canvasElem.height
    var context = canvasElem.getContext('2d')

    context.clearRect(0, 0, width, height)

    var step = Math.ceil(data.length / width)
    var amp = height / 2

    for (var i = 0; i < width; i++) {
        var min = 1.0
        var max = -1.0

        for (var j = 0; j < step; j++) {
            var datum = data[(i * step) + j]

            if (datum < min) min = datum
            if (datum > max) max = datum
        }

        context.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp))
    }
}
