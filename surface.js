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
  this._vertexCount       = 0

  this.contourWidth       = 1
  this.contourValues      = []
  this.showContour        = true
  this.showSurface        = true

  this.contourTint        = 0
  this.contourColor       = [0,0,0,1]

  //Store xyz field now
  this._field = [ ndarray(pool.mallocFloat(1024), [0,0]), ndarray(pool.mallocFloat(1024), [0,0]), ndarray(pool.mallocFloat(1024), [0,0]) ]

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
    height:     0.0,
    contourTint:  0,
    zOffset:      0,
    contourColor: this.contourColor
  }

  if(this.showSurface) {
    //Set up uniforms
    this._shader.bind()
    this._shader.uniforms = uniforms

    //Draw it
    this._vao.bind()
    this._vao.draw(gl.TRIANGLES, this._vertexCount)
    this._vao.unbind()
  }

  if(this.showContour) {
    var shader = this._contourShader

    gl.lineWidth(this.contourWidth)

    uniforms.zOffset = -1e-3
    uniforms.contourTint = this.contourTint

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
  
  var uniforms = {
    model:        params.model || IDENTITY,
    view:         params.view || IDENTITY,
    projection:   params.projection || IDENTITY,
    clipBounds:   this.clipBounds.map(clampVec),
    height:       0.0,
    shape:        this._field[2].shape.slice(),
    pickId:       this.pickId/255.0,
    lowerBound:   this.bounds[0],
    upperBound:   this.bounds[1]
  }

  if(this.showSurface) {
    //Set up uniforms
    this._pickShader.bind()
    this._pickShader.uniforms = uniforms

    //Draw it
    this._vao.bind()
    this._vao.draw(gl.TRIANGLES, this._vertexCount)
    this._vao.unbind()
  }

  if(this.showContour) {
    var shader = this._contourPickShader

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

proto.pick = function(selection) {
  if(!selection) {
    return null
  }

  if(selection.id !== this.pickId) {
    return null
  }

  var shape = this._field[2].shape.slice()

  var x = shape[0] * (selection.value[0] + (selection.value[2]>>4)/16.0)/255.0
  var ix = Math.floor(x)
  var fx = x - ix

  var y = shape[1] * (selection.value[1] + (selection.value[2]&15)/16.0)/255.0
  var iy = Math.floor(y)
  var fy = y - iy

  var pos = [0,0,0]
  for(var dx=0; dx<2; ++dx) {
    var s = dx ? fx : 1.0 - fx
    for(var dy=0; dy<2; ++dy) {
      var t = dy ? fy : 1.0 - fy

      var r = Math.min(ix + dx, shape[0]-1)
      var c = Math.min(iy + dy, shape[1]-1)
      var w = s * t

      for(var i=0; i<3; ++i) {
        pos[i] += this._field[i].get(r,c) * w
      }
    }
  }

  return new SurfacePickResult(pos,
    [ fx<0.5 ? ix : (ix+1),
      fy<0.5 ? iy : (iy+1) ])
}

function padField(field) {
  var nshape = [ field.shape[0]+2, field.shape[1]+2 ]
  var ndata  = pool.mallocFloat(nshape[0]*nshape[1])
  var nfield = ndarray(ndata, nshape)

  //Center
  ops.assign(nfield.lo(1,1).hi(field.shape[0], field.shape[1]), field)

  //Edges
  ops.assign(nfield.lo(1).hi(field.shape[0], 1), 
              field.hi(field.shape[0], 1))
  ops.assign(nfield.lo(1,nshape[1]-1).hi(field.shape[0],1),
              field.lo(0,field.shape[1]-1).hi(field.shape[0],1))
  ops.assign(nfield.lo(0,1).hi(1,field.shape[1]),
              field.hi(1))
  ops.assign(nfield.lo(nshape[0]-1,1).hi(1,field.shape[1]),
              field.lo(field.shape[0]-1))
  //Corners
  nfield.set(0,0, field.get(0,0))
  nfield.set(0,nshape[1]-1, field.get(0,field.shape[1]-1))
  nfield.set(nshape[0]-1,0, field.get(field.shape[0]-1,0))
  nfield.set(nshape[0]-1,nshape[1]-1, field.get(field.shape[0]-1,field.shape[1]-1))

  return nfield
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
  if('contourTint' in params) {
    this.contourTint = +params.contourTint
  }
  if('contourColor' in params) {
    this.contourColor = params.contourColor
  }

  if(params.field) {
    var field = params.field
    if(field.size > this._field[2].data.length) {
      pool.freeFloat(this._field[2].data)
      this._field[2].data = pool.mallocFloat(field.size)
    }
    this._field[2] = ndarray(this._field[2].data, field.shape)
    ops.assign(this._field[2], field)
  }

  //Save shape of field
  var shape = this._field[2].shape.slice()
  this.shape = shape

  //Resize coordinate fields if necessary
  for(var i=0; i<2; ++i) {
    if(this._field[2].size > this._field[i].data.length) {
      pool.freeFloat(this._field[i].data)
      this._field[i].data = pool.mallocFloat(this._field[2].size)
    }
    this._field[i] = ndarray(this._field[i].data, shape)
  }

  //Generate x/y coordinates
  if(params.coords) {
    var coords = params.coords
    if(!Array.isArray(coords) || coords.length !== 2) {
      throw new Error('gl-surface: invalid coordinates for x/y')
    }
    for(var i=0; i<2; ++i) {
      var coord = coords[i]
      for(var j=0; j<2; ++j) {
        if(coord.shape[j] !== shape[j]) {
          throw new Error('gl-surface: coords have incorrect shape')
        }
      }
      ops.assign(this._field[i], coord)
    }
  } else if(params.ticks) {
    var ticks = params.ticks
    if(!Array.isArray(ticks) || ticks.length !== 2) {
      throw new Error('gl-surface: invalid ticks')
    }
    for(var i=0; i<2; ++i) {
      var tick = ticks[i]
      if(Array.isArray(tick) || tick.length) {
        tick = ndarray(tick)
      }
      if(tick.shape[0] !== shape[i]) {
        throw new Error('gl-surface: invalid tick length')
      }
      //Make a copy view of the tick array
      var tick2 = ndarray(tick.data, shape)
      tick2.stride[i] = tick.stride[0]
      tick2.stride[i^1] = 0

      //Fill in field array
      ops.assign(this._field[i], tick2)
    }    
  } else {
    for(var j=0; j<shape[0]; ++j) {
      for(var i=0; i<shape[1]; ++i) {
        this._field[0].set(i,j,j)
        this._field[1].set(i,j,i)
      }
    }
  }

  var fields = this._field

  //Initialize surface
  var lo = [ Infinity, Infinity, Infinity]
  var hi = [-Infinity,-Infinity,-Infinity]
  var count   = (shape[0]-1) * (shape[1]-1) * 6
  var tverts  = pool.mallocFloat(4*count)
  var fverts  = pool.mallocFloat(2*count)
  var tptr    = 0
  var fptr    = 0
  var vertexCount = 0
  for(var i=0; i<shape[0]-1; ++i) {
j_loop:
    for(var j=0; j<shape[1]-1; ++j) {

      //Test for NaNs
      for(var dx=0; dx<2; ++dx) {
        for(var dy=0; dy<2; ++dy) {
          for(var k=0; k<3; ++k) {
            var f = this._field[k].get(i+dx, j+dy)
            if(isNaN(f) || !isFinite(f)) {
              continue j_loop
            }
          }
        }
      }
      for(var k=0; k<6; ++k) {
        var r = i + QUAD[k][0]
        var c = j + QUAD[k][1]

        var tx = this._field[0].get(r, c)
        var ty = this._field[1].get(r, c)
        var f  = this._field[2].get(r, c)

        tverts[tptr++] = r
        tverts[tptr++] = c
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

        vertexCount += 1
      }
    }
  }
  this._vertexCount = vertexCount
  this._valueBuffer.update(fverts)
  this._coordinateBuffer.update(tverts)
  pool.freeFloat(tverts)
  pool.freeFloat(fverts)

  //Update bounds
  this.bounds = [lo, hi]

  //Update contour lines
  var levels = this.contourValues
  var contourVerts = []
  var levelOffsets = []
  var levelCounts  = []

  var parts = [0,0]
  var graphParts = [0,0]

  var padded = padField(this._field[2])

  for(var i=0; i<levels.length; ++i) {
    var graph = surfaceNets(padded, levels[i])
    levelOffsets.push((contourVerts.length/4)|0)
    var vertexCount = 0

edge_loop:
    for(var j=0; j<graph.cells.length; ++j) {
      var e = graph.cells[j]
      for(var k=0; k<2; ++k) {
        var p = graph.positions[e[k]]

        var x = p[0]-1
        var ix = Math.floor(x)|0
        var fx = x - ix

        var y = p[1]-1
        var iy = Math.floor(y)|0
        var fy = y - iy

        
        var hole = false
dd_loop:
        for(var dd=0; dd<2; ++dd) {
          parts[dd] = 0.0
          for(var dx=0; dx<2; ++dx) {
            var s = dx ? fx : 1.0 - fx
            var r = Math.min(Math.max(ix+dx, 0), shape[0]-1)|0
            for(var dy=0; dy<2; ++dy) {
              var t = dy ? fy : 1.0 - fy
              var c = Math.min(Math.max(iy+dy, 0), shape[1]-1)|0

              var f = this._field[dd].get(r,c)
              if(!isFinite(f) || isNaN(f)) {
                hole = true
                break dd_loop
              }

              var w = s * t
              parts[dd] += w * this._field[dd].get(r, c)
            }
          }
        }

        if(!hole) {
          contourVerts.push(parts[0], parts[1], p[0], p[1])
          vertexCount += 1
        } else {
          if(k > 0) {
            //If we already added first edge, pop off verts
            for(var l=0; l<4; ++l) {
              contourVerts.pop()
            }
            vertexCount -= 1
          }
          continue edge_loop
        }
      }
    }
    levelCounts.push(vertexCount)
  }

  pool.freeFloat(padded.data)

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
  for(var i=0; i<3; ++i) {
    pool.freeFloat(this._field[i].data)
  }
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
  nparams.colormap = nparams.colormap || 'jet'

  surface.update(nparams)

  return surface
}