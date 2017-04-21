'use strict'

if (!navigator.mediaDevices) {
  console.log('getUserMedia() not supported.')
}

var client
var roomName
var context
var playbackCtx
var recorder
var audioContext = window.AudioContext || window.webkitAudioContext
var contextSampleRate = (new audioContext()).sampleRate

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

    client.on('open', function() {
        console.log('connection open')

        client.send('join', roomName)
        client.send('broadcast_started', roomName)
    })

    if (context) {
        recorder.connect(context.destination)
        return
    }

    var constraints = {
        audio: true,
        video: false
    }

    navigator.mediaDevices.getUserMedia(constraints)
        .then(function(rawStream) {
            console.log('rawStream', rawStream)
            context = new audioContext()
            var audioInput = context.createMediaStreamSource(rawStream)
            var bufferSize = 1024
            var inputChannelsNum = 1
            var outputChannelsNum = 1

            recorder = context.createScriptProcessor(bufferSize, inputChannelsNum, outputChannelsNum)
            recorder.onaudioprocess = onAudio

            audioInput.connect(recorder)
            recorder.connect(context.destination)
        })
        .catch(function(err) {
            console.error(err)
        })
})

stopBtn.addEventListener('click', function() {
    client.send('broadcast_stopped', roomName)
    close()
})

function onAudio(e) {
    // since we're recording mono, we only have the left channel
    var left = e.inputBuffer.getChannelData(0)
    client.write(left)

    drawBuffer(left)
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

function close(){
    console.log('close')

    if (recorder) recorder.disconnect()
    if (client) client.end()
}
