"use strict"

var shell = require("gl-now")({ clearColor: [0,0,0,0] })
var camera = require("game-shell-orbit-camera")(shell)
var createSurface = require("../surface.js")
var createAxes = require("gl-axes")
var createSpikes = require("gl-spikes")
var ndarray = require("ndarray")
var fill = require("ndarray-fill")
var diric = require("dirichlet")
var glm = require("gl-matrix")
var createSelect = require("gl-select")
var mat4 = glm.mat4

var surface, spikes, axes, select, target = null

var size = 256

shell.on("gl-init", function() {
  var gl = shell.gl
  gl.enable(gl.DEPTH_TEST)

  //Set up camera
  camera.lookAt(
    [-size, -size, 1.5*size],      //Eye position
    [size, size, 0.5 * size], //Eye target
    [0, 0, 1])      //Up direction

  //Create field
  var field = ndarray(new Float32Array(4*(size+1)*(size+1)), [2*size+1,2*size+1])
  fill(field, function(x,y) {
    return 0.5 * size * diric(10, 5.0*(x-size)/size) * diric(10, 5.0*(y-size)/size)
  })

  //Create ticks
  var ticks = [ ndarray(new Float32Array(2*size+1)), ndarray(new Float32Array(2*size+1)) ]
  for(var i=0; i<2*size+1; ++i) {
    ticks[0].set(i, Math.sqrt(i))
    ticks[1].set(i, i)
  }

  var contourLevels = []
  for(var i=-10; i<=50; ++i) {
    contourLevels.push(size*i/50.0)
  }
  
  surface = createSurface(gl, field, {
    levels: contourLevels,
    lineWidth: 3,
    //showContour: false
    showSurface: false

  })

  spikes = createSpikes(gl, {
    bounds: surface.bounds
  })

  axes = createAxes(gl, {
    bounds: surface.bounds,
    tickSpacing: [0.125*size, 0.125*size, 0.125*size],
    textSize: size / 32.0,
    gridColor: [0.8,0.8,0.8]
  })

  select = createSelect(gl, [shell.height, shell.width])
})

function drawPick(cameraParams) {
  select.shape = [shell.height, shell.width]
  select.begin(shell.mouse[0], shell.mouse[1], 30)
  surface.drawPick(cameraParams)
  target = surface.pick(select.end())
}

shell.on("gl-render", function() {
  var cameraParams = {
    view: camera.view(),
    projection:  mat4.perspective(
      new Array(16), Math.PI/4.0, shell.width/shell.height, 0.1, 10000.0)
  }

  drawPick(cameraParams)

  surface.draw(cameraParams)
  axes.draw(cameraParams)

  if(target) {
    spikes.position = target.position
    spikes.draw(cameraParams)
  }
})