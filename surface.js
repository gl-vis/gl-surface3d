'use strict'

module.exports = createSurfacePlot

var glslify       = require('glslify')
var createBuffer  = require('gl-buffer')
var createVAO     = require('gl-vao')
var createTexture = require('gl-texture2d')
var pool          = require('typedarray-pool')
var colormap      = require('colormap')
var ops           = require('ndarray-ops')
var pack          = require('ndarray-pack')
var ndarray       = require('ndarray')
var surfaceNets   = require('surface-nets')

var createShader = glslify({
    vertex:   './shaders/vertex.glsl',
    fragment: './shaders/fragment.glsl'
  }),
  createContourShader = glslify({
    vertex:   './shaders/contour-vertex.glsl',
    fragment: './shaders/fragment.glsl'
  }),
  createPickShader = glslify({
    vertex:   './shaders/vertex.glsl',
    fragment: './shaders/pick.glsl'
  }),
  createPickContourShader = glslify({
    vertex:   './shaders/contour-vertex.glsl',
    fragment: './shaders/pick.glsl'
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

function SurfacePickResult(position, index) {
  this.position = position
  this.index    = index
}

function genColormap(name) {
  var x = pack([colormap({
    colormap: name,
    nshades: 256,
    format: 'rgb'
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

function SurfacePlot(
  gl, 
  shape, 
  bounds, 
  shader, 
  pickShader, 
  coordinates, 
  values, 
  vao, 
  colorMap,
  contourShader,
  contourPickShader,
  contourBuffer,
  contourVAO) {

  this.gl = gl
  this.shape = shape
  this.bounds = bounds

  this._shader = shader
  this._pickShader = pickShader
  this._coordinateBuffer = coordinates
  this._valueBuffer = values
  this._vao = vao
  this._colorMap = colorMap

  this._contourShader     = contourShader
  this._contourPickShader = contourPickShader
  this._contourBuffer     = contourBuffer
  this._contourVAO        = contourVAO
  this._contourOffsets    = []
  this._contourCounts     = []

  this.contourWidth       = 1
  this.contourValues      = []
  this.showContour        = true
  this.showSurface        = true

  this._field = ndarray(pool.mallocFloat(1024), [0,0])
  this._ticks = [ ndarray(pool.mallocFloat(1024)), ndarray(pool.mallocFloat(1024)) ]
  this.pickId = 1
  this.clipBounds = [[-Infinity,-Infinity,-Infinity],[Infinity,Infinity,Infinity]]
}

var proto = SurfacePlot.prototype

proto.draw = function(params) {
  params = params || {}
  var gl = this.gl
  

  var uniforms = {
    model:      params.model || IDENTITY,
    view:       params.view || IDENTITY,
    projection: params.projection || IDENTITY,
    lowerBound: this.bounds[0],
    upperBound: this.bounds[1],
    colormap:   this._colorMap.bind(0),
    clipBounds: this.clipBounds.map(clampVec),
    height:     0.0
  }

  if(this.showSurface) {
    //Set up uniforms
    this._shader.bind()
    this._shader.uniforms = uniforms

    //Draw it
    this._vao.bind()
    this._vao.draw(gl.TRIANGLES, (this.shape[0]-1) * (this.shape[1]-1) * 6)
    this._vao.unbind()
  }

  if(this.showContour) {
    var shader = this._contourShader

    gl.lineWidth(this.contourWidth)

    shader.bind()
    shader.uniforms = uniforms

    var vao = this._contourVAO
    vao.bind()
    for(var i=0; i<this.contourValues.length; ++i) {
      shader.uniforms.height = this.contourValues[i]
      vao.draw(gl.LINES, this._contourCounts[i], this._contourOffsets[i])
    }
    vao.unbind()
  }
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

  var s0 = this._ticks[0].get(ix)
  var s1 = this._ticks[0].get(ix+1)
  var t0 = this._ticks[1].get(iy)
  var t1 = this._ticks[1].get(iy+1)

  return new SurfacePickResult([
    s0*(1.0-fx) + s1*fx, 
    t0*(1.0-fy) + t1*fy, 
    z],
    [ fx<0.5 ? ix : (ix+1),
      fy<0.5 ? iy : (iy+1) ])
}

proto.update = function(params) {
  params = params || {}

  if('pickId' in params) {
    this.pickId = params.pickId|0
  }
  if('levels' in params) {
    this.contourValues = params.levels
  }
  if('lineWidth' in params) {
    this.contourWidth = params.lineWidth
  }
  if('showContour' in params) {
    this.showContour = !!params.showContour
  }
  if('showSurface' in params) {
    this.showSurface = !!params.showSurface
  }

  if(params.field) {
    var field = params.field
    if(field.size > this._field.data.length) {
      pool.freeFloat(this._field.data)
      this._field.data = pool.mallocFloat(field.size)
    }
    this._field = ndarray(this._field.data, field.shape)
    ops.assign(this._field, field)
  }

  if(params.ticks) {
    var curTicks = this._ticks
    var nextTicks = params.ticks
    for(var i=0; i<2; ++i) {
      var cur = curTicks[i]
      var next = nextTicks[i]
      if(Array.isArray(next)) {
        next = ndarray(next)
      }
      if(next.shape[0] !== this._field.shape[i]) {
        throw new Error('gl-surface-plot: Incompatible shape')
      }
      if(cur.data.length < next.shape[0]) {
        pool.free(cur.data)
        cur.data = pool.mallocFloat(next.shape[0])
      }
      cur.shape[0] = next.shape[0]
      ops.assign(cur, next)
    }
  } else {
    var ticks = this._ticks
    for(var i=0; i<2; ++i) {
      var cur = ticks[i]
      var nn = this._field.shape[i]
      if(cur.shape[0] !== nn) {
        if(cur.data.length < nn) {
          pool.free(cur.data)
          cur.data = pool.mallocFloat(nn)
        }
        cur.shape[0] = nn
        for(var j=0; j<nn; ++j) {
          cur.set(j, j)
        }
      }
    }
  }

  var field = this._field
  var ticks = this._ticks

  //Update coordinates of field
  var lo = [ Infinity, Infinity, Infinity]
  var hi = [-Infinity,-Infinity,-Infinity]
  var nshape = field.shape.slice()
  this.shape = nshape
  
  var count   = (nshape[0]-1) * (nshape[1]-1) * 6
  var tverts  = pool.mallocFloat(4*count)
  var fverts  = pool.mallocFloat(2*count)
  var tptr    = 0
  var fptr    = 0
  for(var i=0; i<nshape[0]-1; ++i) {
    for(var j=0; j<nshape[1]-1; ++j) {
      var skip_flag = false
      for(var dx=0; dx<2; ++dx) {
        var tx = ticks[0].get(i + dx)
        if(isNaN(tx) || !isFinite(tx)) {
          skip_flag = true 
        }
        for(var dy=0; dy<2; ++dy) {
          var ty = ticks[1].get(j+dy)
          if(isNaN(ty) || !isFinite(ty)) {
            skip_flag = true
          }
          var f = field.get(i+dx, j+dy)
          if(isNaN(f) || !isFinite(f)) {
            skip_flag = true
          }
        }
      }
      if(skip_flag) {
        for(var k=0; k<6; ++k) {
          for(var l=0; l<4; ++l) {
            tverts[tptr++] = 0
          }
          for(var l=0; l<2; ++l) {
            fverts[fptr++] = 1
          }
        }
      } else {
        for(var k=0; k<6; ++k) {
          var tx = ticks[0].get(i + QUAD[k][0])
          var ty = ticks[1].get(j + QUAD[k][1])
          var f  = field.get(i+QUAD[k][0], j+QUAD[k][1])

          tverts[tptr++] = i + QUAD[k][0]
          tverts[tptr++] = j + QUAD[k][1]
          tverts[tptr++] = tx
          tverts[tptr++] = ty
          fverts[fptr++] = f
          fverts[fptr++] = 0

          lo[0] = Math.min(lo[0], tx)
          lo[1] = Math.min(lo[1], ty)
          lo[2] = Math.min(lo[2], f)

          hi[0] = Math.max(hi[0], tx)
          hi[1] = Math.max(hi[1], ty)
          hi[2] = Math.max(hi[2], f)
        }
      }      
    }
  }
  this._valueBuffer.update(fverts)
  this._coordinateBuffer.update(tverts)
  pool.freeFloat(tverts)
  pool.freeFloat(fverts)

  for(var i=0; i<3; ++i) {
    this.bounds[0][i] = lo[i]
    this.bounds[1][i] = hi[i]
  }
  

  //Update contour lines
  var levels = this.contourValues
  var contourVerts = []
  var levelOffsets = []
  var levelCounts  = []
  for(var i=0; i<levels.length; ++i) {
    var graph = surfaceNets(this._field, levels[i])
    levelOffsets.push((contourVerts.length/4)|0)
    for(var j=0; j<graph.cells.length; ++j) {
      var e = graph.cells[j]
      for(var k=0; k<2; ++k) {
        var p = graph.positions[e[k]]
        for(var l=0; l<2; ++l) {
          var x = p[l]
          var ix = Math.floor(x)|0
          var fx = x - ix
          var t0 = ticks[0].get(Math.max(ix, 0)|0)
          var t1 = ticks[0].get(Math.min(ix, nshape[0]-1)|0)
          contourVerts.push((1.0-fx)*t0 + fx*t1)
        }
        contourVerts.push(p[0], p[1])
      }
    }
    levelCounts.push(2*graph.cells.length)
  }
  this._contourOffsets  = levelOffsets
  this._contourCounts   = levelCounts

  var floatBuffer = pool.mallocFloat(contourVerts.length)
  for(var i=0; i<contourVerts.length; ++i) {
    floatBuffer[i] = contourVerts[i]
  }
  this._contourBuffer.update(floatBuffer)
  pool.freeFloat(floatBuffer)

  if(typeof params.colormap === "string") {
    this._colorMap.setPixels(genColormap(params.colormap))
  } else {
    //TODO: Support for colormap arrays
  }
}

proto.dispose = function() {
  this._shader.dispose()
  this._vao.dispose()
  this._coordinateBuffer.dispose()
  this._valueBuffer.dispose()
  this._colorMap.dispose()
  this._contourBuffer.dispose()
  this._contourVAO.dispose()
  this._contourShader.dispose()
  this._contourPickShader.dispose()
  pool.freeFloat(this._field.data)
}

function createSurfacePlot(gl, field, params) {
  var shader = createShader(gl)
  shader.attributes.uv.location = 0
  shader.attributes.f.location = 1

  var pickShader = createPickShader(gl)
  pickShader.attributes.uv.location = 0
  pickShader.attributes.f.location = 1

  var contourShader = createContourShader(gl)
  contourShader.attributes.uv.location = 0

  var contourPickShader = createPickContourShader(gl)
  contourPickShader.attributes.uv.location = 0

  var estimatedSize = (field.shape[0]-1) * (field.shape[1]-1) * 6 * 4

  var coordinateBuffer = createBuffer(gl, estimatedSize * 4)
  var valueBuffer = createBuffer(gl, estimatedSize)
  var vao = createVAO(gl, [
      { buffer: coordinateBuffer,
        size: 4
      },
      { buffer: valueBuffer,
        size: 2
      }
    ])

  var contourBuffer = createBuffer(gl)
  var contourVAO = createVAO(gl, [
    { 
      buffer: contourBuffer,
      size: 4
    }])

  var cmap = createTexture(gl, 1, 256, gl.RGBA, gl.UNSIGNED_BYTE)
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
    cmap,
    contourShader,
    contourPickShader,
    contourBuffer,
    contourVAO)
  var nparams = {}
  for(var id in params) {
    nparams[id] = params[id]
  }
  nparams.field = field
  nparams.colormap = nparams.colormap || "jet"
  surface.update(nparams)
  return surface
}