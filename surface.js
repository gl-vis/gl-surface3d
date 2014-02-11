"use strict"

module.exports = createSurfacePlot

var glslify = require("glslify")
var createBuffer = require("gl-buffer")
var createVAO = require("gl-vao")
var createTexture = require("gl-texture2d")
var pool = require("typedarray-pool")
var colormap = require("colormap")
var ops = require("ndarray-ops")
var pack = require("ndarray-pack")

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
  [1, 1],
  [1, 0],
  [0, 1]
]

function genColormap(name) {
  var x = pack([colormap({
    colormap: name,
    nshades: 256,
    format: "rgb"
  }).map(function(c) {
    return [c[0], c[1], c[2], 255]
  })])
  ops.divseq(x, 255.0)
  return x
}

function SurfacePlot(gl, shape, bounds, shader, coordinates, values, vao, colorMap) {
  this.gl = gl
  this.shape = shape
  this.bounds = bounds
  this._shader = shader
  this._coordinateBuffer = coordinates
  this._valueBuffer = values
  this._vao = vao
  this._colorMap = colorMap
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
  this._shader.uniforms.lowerBound = this.bounds[0]
  this._shader.uniforms.upperBound = this.bounds[1]
  this._shader.uniforms.colormap = this._colorMap.bind(0)

  //Draw it
  this._vao.bind()
  this._vao.draw(gl.TRIANGLES, (this.shape[0]-1) * (this.shape[1]-1) * 6)
  this._vao.unbind()
}

proto.update = function(params) {
  params = params || {}

  if(params.field) {
    var field = params.field

    //Update coordinates of field
    var nshape = field.shape.slice()
    if(nshape[0] !== this.shape[0] || nshape[1] !== this.shape[1]) {
      this.shape = nshape
      var count = (nshape[0]-1) * (nshape[1]-1) * 6 * 2
      var verts = pool.mallocFloat(count)
      var ptr = 0
      for(var i=0; i<nshape[0]-1; ++i) {
        for(var j=0; j<nshape[1]-1; ++j) {
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
    for(var i=0; i<nshape[0]-1; ++i) {
      for(var j=0; j<nshape[1]-1; ++j) {
        for(var k=0; k<6; ++k) {
          var v = field.get(i + QUAD[k][0], j + QUAD[k][1])
          verts[ptr++] = v
          minZ = Math.min(minZ, v)
          maxZ = Math.max(maxZ, v)
        }
      }
    }
    this._valueBuffer.update(verts)

    //Update bounding box
    this.bounds = [
      [0, 0, minZ],
      [nshape[0], nshape[1], maxZ]
    ]
  }

  if(typeof params.colormap === "string") {
    this._colorMap.setPixels(genColormap(params.colormap))
  }
}

proto.dispose = function() {
  this._shader.dispose()
  this._vao.dispose()
  this._coordinateBuffer.dispose()
  this._valueBuffer.dispose()
  this._colorMap.dispose()
}

function createSurfacePlot(gl, field, params) {
  var shader = createShader(gl)
  shader.attributes.uv.location = 0
  shader.attributes.f.location = 1
  var estimatedSize = (field.shape[0]-1) * (field.shape[1]-1) * 6 * 4
  var coordinateBuffer = createBuffer(gl, estimatedSize * 2)
  var valueBuffer = createBuffer(gl, estimatedSize)
  var vao = createVAO(gl, [
      { buffer: coordinateBuffer,
        size: 2
      },
      { buffer: valueBuffer,
        size: 1
      }
    ])
  var cmap = createTexture(gl, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE)
  cmap.minFilter = gl.LINEAR
  cmap.magFilter = gl.LINEAR
  var surface = new SurfacePlot(
    gl, 
    [0,0], 
    [[0,0,0], [0,0,0]], 
    shader, 
    coordinateBuffer, 
    valueBuffer,
    vao,
    cmap)
  var nparams = {}
  for(var id in params) {
    nparams[id] = params[id]
  }
  nparams.field = field
  nparams.colormap = nparams.colormap || "jet"
  surface.update(nparams)
  return surface
}