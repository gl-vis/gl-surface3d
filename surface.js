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
var ndarray = require("ndarray")

var createShader = glslify({
  vertex: "./shaders/vertex.glsl",
  fragment: "./shaders/fragment.glsl"
})

var createPickShader = glslify({
  vertex: "./shaders/vertex.glsl",
  fragment: "./shaders/pick.glsl"
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

function SurfacePickResult(position) {
  this.position = position
}

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

function clampVec(v) {
  var result = new Array(3)
  for(var i=0; i<3; ++i) {
    result[i] = Math.min(Math.max(v[i], -1e8), 1e8)
  }
  return result
}

function SurfacePlot(gl, shape, bounds, shader, pickShader, coordinates, values, vao, colorMap) {
  this.gl = gl
  this.shape = shape
  this.bounds = bounds
  this._shader = shader
  this._pickShader = pickShader
  this._coordinateBuffer = coordinates
  this._valueBuffer = values
  this._vao = vao
  this._colorMap = colorMap
  this._field = ndarray(pool.mallocFloat(1024), [0,0])
  this.pickId = 1
  this.clipBounds = [[-Infinity,-Infinity,-Infinity],[Infinity,Infinity,Infinity]]
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
  this._shader.uniforms.clipBounds = this.clipBounds.map(clampVec)

  //Draw it
  this._vao.bind()
  this._vao.draw(gl.TRIANGLES, (this.shape[0]-1) * (this.shape[1]-1) * 6)
  this._vao.unbind()
}

proto.drawPick = function(params) {
  params = params || {}
  var gl = this.gl
  
  //Set up uniforms
  var shader = this._pickShader
  shader.bind()
  shader.uniforms.model = params.model || IDENTITY
  shader.uniforms.view = params.view || IDENTITY
  shader.uniforms.projection = params.projection || IDENTITY
  shader.uniforms.clipBounds = this.clipBounds.map(clampVec)
  shader.uniforms.shape = this._field.shape.slice()
  shader.uniforms.pickId = this.pickId / 255.0

  //Draw it
  this._vao.bind()
  this._vao.draw(gl.TRIANGLES, (this.shape[0]-1) * (this.shape[1]-1) * 6)
  this._vao.unbind()
}

proto.pick = function(selection) {
  if(!selection) {
    return null
  }

  if(selection.id !== this.pickId) {
    return null
  }

  var x = this._field.shape[0] * (selection.value[0] + (selection.value[2]>>4)/16.0)/255.0
  var ix = Math.floor(x)
  var fx = x - ix

  var y = this._field.shape[1] * (selection.value[1] + (selection.value[2]&15)/16.0)/255.0
  var iy = Math.floor(y)
  var fy = y - iy

  var z = 0.0
  for(var dx=0; dx<2; ++dx) {
    var s = dx ? fx : 1.0 - fx
    for(var dy=0; dy<2; ++dy) {
      var t = dy ? fy : 1.0 - fy
      var f = this._field.get(
        Math.min(ix + dx, this._field.shape[0]-1),
        Math.min(iy + dy, this._field.shape[1]-1))
      z += f * s * t
    }
  }

  return new SurfacePickResult([x, y, z])
}

proto.update = function(params) {
  params = params || {}

  if("pickId" in params) {
    this.pickId = params.pickId|0
  }

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

    //Copy field
    if(field.size > this._field.data.length) {
      pool.freeFloat(this._field.data)
      this._field.data = pool.mallocFloat(field.size)
    }
    this._field = ndarray(this._field.data, field.shape)
    ops.assign(this._field, field)

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
  pool.freeFloat(this._field.data)
}

function createSurfacePlot(gl, field, params) {
  var shader = createShader(gl)
  shader.attributes.uv.location = 0
  shader.attributes.f.location = 1
  var pickShader = createPickShader(gl)
  pickShader.attributes.uv.location = 0
  pickShader.attributes.f.location = 1
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
    pickShader,
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