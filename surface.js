"use strict"

module.exports = createSurfacePlot

var glslify = require("glslify")
var createBuffer = require("gl-buffer")
var createVAO = require("gl-vao")
var pool = require("typedarray-pool")

var createShader = glslify({
  vertex: "./vertex.glsl",
  fragment: "./fragment.glsl"
})

var IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1 ]

var QUAD = [
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 0],
  [1, 1],
  [0, 1]
]

function SurfacePlot(gl, shape, bounds, shader, coordinates, values, vao) {
  this.gl = gl
  this.shape = shape
  this.bounds = bounds
  this._shader = shader
  this._coordinateBuffer = coordinates
  this._valueBuffer = values
  this._vao = vao
}

var proto = SurfacePlot.prototype

proto.draw = function(params) {
  params = params || {}
  var gl = this.gl
  
  //Set up uniforms
  this._shader.bind()
  this._shader.uniforms.model = params.model || IDENTITY
  this._shader.uniforms.view = params.view || IDENTITY
  this._shader.uniforms.projection = params.projection || IDENTITY

  //Draw it
  this._vao.bind()
  gl.drawArrays(gl.TRIANGLES, 0, (this.shape[0]-1) * (this.shape[1]-1) * 6)
  this._vao.unbind()
}

proto.update = function(field, params) {
  params = params || {}

  //Update coordinates of field
  var nshape = field.shape.slice()
  if(nshape[0] !== this.shape[0] || nshape[1] !== this.shape[1]) {
    this.shape = nshape
    var count = (nshape[0]-1) * (nshape[1]-1) * 6 * 2
    var verts = pool.mallocFloat(count)
    var ptr = 0
    for(var i=0; i<nshape[0]; ++i) {
      for(var j=0; j<nshape[1]; ++j) {
        for(var k=0; k<6; ++k) {
          verts[ptr++] = i + QUAD[k][0]
          verts[ptr++] = j + QUAD[k][1]
        }
      }
    }
    this._coordinateBuffer.update(verts)
    pool.freeFloat(verts)
  }

  //Update field values
  var minZ = Infinity
  var maxZ = -Infinity
  var count = (nshape[0]-1) * (nshape[1]-1) * 6
  var verts = pool.mallocFloat(count)
  var ptr = 0
  for(var i=0; i<nshape[0]; ++i) {
    for(var j=0; j<nshape[1]; ++j) {
      var v = field.get(i, j)
      for(var k=0; k<6; ++k) {
        verts[ptr++] = v
      }
      minZ = Math.min(minZ, v)
      maxZ = Math.max(maxZ, v)
    }
  }
  this._valueBuffer.update(verts)

  //Update bounding box
  this.bounds = [
    [0, 0, minZ],
    [nshape[0], shape[1], maxZ]
  ]
}

proto.dispose = function() {
  this._shader.dispose()
  this._vao.dispose()
  this._coordinateBuffer.dispose()
  this._valueBuffer.dispose()
}

function createSurfacePlot(gl, field, params) {
  var shader = createShader(gl)
  var coordinateBuffer = createBuffer(gl)
  var valueBuffer = createBuffer(gl)
  var vao = createVAO(gl, [
      {
        buffer: coordinateBuffer,
        size: 2
      },
      {
        buffer: valueBuffer,
        size: 1
      }
    ])
  var surface = new Surface(
    gl, 
    [0,0], 
    [[0,0,0], [0,0,0]], 
    shader, 
    coordinateBuffer, 
    valueBuffer)
  surface.update(field, params)
  return surface
}