'use strict'

module.exports = createSurfacePlot

var dup           = require('dup')
var bits          = require('bit-twiddle')
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
var getCubeProps  = require('gl-axes/lib/cube')
var multiply      = require('gl-mat4/multiply')
var bsearch       = require('binary-search-bounds')

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

var PERMUTATIONS = [
  [0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0]
]

;(function() {
  for(var i=0; i<3; ++i) {
    var p = PERMUTATIONS[i]
    var u = (i+1) % 3
    var v = (i+2) % 3
    p[u + 0] = 1
    p[v + 3] = 1
    p[i + 6] = 1
  }
})()

function SurfacePickResult(position, index, uv, level) {
  this.position     = position
  this.index        = index
  this.uv           = uv
  this.level        = level
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
  contourVAO,
  dynamicBuffer,
  dynamicVAO) {

  this.gl                 = gl
  this.shape              = shape
  this.bounds             = bounds

  this._shader            = shader
  this._pickShader        = pickShader
  this._coordinateBuffer  = coordinates
  this._valueBuffer       = values
  this._vao               = vao
  this._colorMap          = colorMap

  this._contourShader     = contourShader
  this._contourPickShader = contourPickShader
  this._contourBuffer     = contourBuffer
  this._contourVAO        = contourVAO
  this._contourOffsets    = [[], [], []]
  this._contourCounts     = [[], [], []]
  this._vertexCount       = 0

  this._dynamicBuffer     = dynamicBuffer
  this._dynamicVAO        = dynamicVAO
  this._dynamicOffsets    = [0,0,0]
  this._dynamicCounts     = [0,0,0]

  this.contourWidth       = [ 1, 1, 1 ]
  this.contourLevels      = [[], [], []]
  this.contourTint        = [0, 0, 0]
  this.contourColor       = [[0.5,0.5,0.5,1], [0.5,0.5,0.5,1], [0.5,0.5,0.5,1]]

  this.showContour        = true
  this.showSurface        = true

  this.highlightColor     = [[0,0,0,1], [0,0,0,1], [0,0,0,1]]
  this.highlightTint      = [ 1, 1, 1 ]
  this.highlightLevel     = [-1, -1, -1]

  //Dynamic contour options
  this.dynamicLevel       = [ NaN, NaN, NaN ]
  this.dynamicColor       = [ [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1] ]
  this.dynamicTint        = [ 1, 1, 1 ]
  this.dynamicWidth       = [ 1, 1, 1 ]

  this.axesBounds         = [[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]]
  this.surfaceProject     = [ false, false, false ]
  this.contourProject     = [ false, false, false ]

  //Store xyz field now
  this._field             = [ 
      ndarray(pool.mallocFloat(1024), [0,0]), 
      ndarray(pool.mallocFloat(1024), [0,0]), 
      ndarray(pool.mallocFloat(1024), [0,0]) ]

  this.pickId             = 1
  this.clipBounds         = [[-Infinity,-Infinity,-Infinity],[Infinity,Infinity,Infinity]]
}

var proto = SurfacePlot.prototype

function computeProjectionData(camera, obj) {
  //Compute cube properties
  var cubeProps = getCubeProps(
      camera.model, 
      camera.view, 
      camera.projection, 
      obj.axesBounds)
  var cubeAxis  = cubeProps.axis

  var showSurface = obj.showSurface
  var showContour = obj.showContour
  var projections = [null,null,null]
  var clipRects   = [null,null,null]
  for(var i=0; i<3; ++i) {
    showSurface = showSurface || obj.surfaceProject[i]
    showContour = showContour || obj.contourProject[i]

    if(obj.surfaceProject[i] || obj.contourProject[i]) {
      //Construct projection onto axis
      var axisSquish = IDENTITY.slice()

      axisSquish[5*i] = 0
      axisSquish[12+i] = obj.axesBounds[+(cubeAxis[i]>0)][i]
      multiply(axisSquish, camera.model, axisSquish)
      projections[i] = axisSquish

      var nclipBounds = [camera.clipBounds[0].slice(), camera.clipBounds[1].slice()]
      nclipBounds[0][i] = -1e8
      nclipBounds[1][i] = 1e8
      clipRects[i] = nclipBounds
    }
  }

  return {
    showSurface: showSurface,
    showContour: showContour,
    projections: projections,
    clipBounds: clipRects
  }
}

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
    contourColor: this.contourColor[0],
    permutation: [1,0,0,0,1,0,0,0,1],
    zOffset:     -1e-3
  }

  var projectData = computeProjectionData(uniforms, this)

  if(projectData.showSurface) {
    //Set up uniforms
    this._shader.bind()
    this._shader.uniforms = uniforms

    //Draw it
    this._vao.bind()

    if(this.showSurface) {
      this._vao.draw(gl.TRIANGLES, this._vertexCount)
    }

    //Draw projections of surface
    for(var i=0; i<3; ++i) {
      if(!this.surfaceProject[i]) {
        continue
      }
      this._shader.uniforms.model = projectData.projections[i]
      this._shader.uniforms.clipBounds = projectData.clipBounds[i]
      this._vao.draw(gl.TRIANGLES, this._vertexCount)
    }

    this._vao.unbind()
  }

  if(projectData.showContour) {
    var shader = this._contourShader

    shader.bind()
    shader.uniforms = uniforms

    //Draw contour lines
    var vao = this._contourVAO
    vao.bind()

    //Draw contour levels
    for(var i=0; i<3; ++i) {
      shader.uniforms.permutation = PERMUTATIONS[i]
      gl.lineWidth(this.contourWidth[i])

      for(var j=0; j<this.contourLevels[i].length; ++j) {
        if(j === this.highlightLevel[i]) {
          shader.uniforms.contourColor = this.highlightColor[i]
          shader.uniforms.contourTint  = this.highlightTint[i]

        } else if(j === 0 || (j-1) === this.highlightLevel[i]) {
          shader.uniforms.contourColor = this.contourColor[i]
          shader.uniforms.contourTint  = this.contourTint[i]
        }
        shader.uniforms.height = this.contourLevels[i][j]
        vao.draw(gl.LINES, this._contourCounts[i][j], this._contourOffsets[i][j])
      }
    }

    //Draw projections of surface
    for(var i=0; i<3; ++i) {
      if(!this.contourProject[i]) {
        continue
      }
      shader.uniforms.model      = projectData.projections[i]
      shader.uniforms.clipBounds = projectData.clipBounds[i]
      for(var j=0; j<3; ++j) {
        shader.uniforms.permutation = PERMUTATIONS[j]
        gl.lineWidth(this.contourWidth[j])
        for(var k=0; k<this.contourLevels[j].length; ++k) {
          if(k === this.highlightLevel[j]) {
            shader.uniforms.contourColor  = this.highlightColor[j]
            shader.uniforms.contourTint   = this.highlightTint[j]
          } else if(k === 0 || (k-1) === this.highlightLevel[j]) {
            shader.uniforms.contourColor  = this.contourColor[j]
            shader.uniforms.contourTint   = this.contourTint[j]
          }
          shader.uniforms.height = this.contourLevels[j][k]
          vao.draw(gl.LINES, this._contourCounts[j][k], this._contourOffsets[j][k])
        }
      }
    }
    
    //Draw dynamic contours
    vao = this._dynamicVAO
    vao.bind()

    //Draw contour levels
    for(var i=0; i<3; ++i) {
      if(this._dynamicCounts[i] === 0) {
        continue
      }

      shader.uniforms.model       = uniforms.model
      shader.uniforms.clipBounds  = uniforms.clipBounds
      shader.uniforms.permutation = PERMUTATIONS[i]
      gl.lineWidth(this.dynamicWidth[i])

      shader.uniforms.contourColor = this.dynamicColor[i]
      shader.uniforms.contourTint  = this.dynamicTint[i]
      shader.uniforms.height       = this.dynamicLevel[i]
      vao.draw(gl.LINES, this._dynamicCounts[i], this._dynamicOffsets[i])

      for(var j=0; j<3; ++j) {
        if(!this.contourProject[j]) {
          continue
        }

        shader.uniforms.model      = projectData.projections[j]
        shader.uniforms.clipBounds = projectData.clipBounds[j]
        vao.draw(gl.LINES, this._dynamicCounts[i], this._dynamicOffsets[i])
      }
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
    upperBound:   this.bounds[1],
    zOffset:      0.0,
    permutation: [1,0,0,0,1,0,0,0,1]
  }

  var projectData = computeProjectionData(uniforms, this)

  if(projectData.showSurface) {
    //Set up uniforms
    this._pickShader.bind()
    this._pickShader.uniforms = uniforms

    //Draw it
    this._vao.bind()
    this._vao.draw(gl.TRIANGLES, this._vertexCount)

    //Draw projections of surface
    for(var i=0; i<3; ++i) {
      if(!this.surfaceProject[i]) {
        continue
      }
      this._pickShader.uniforms.model = projectData.projections[i]
      this._pickShader.uniforms.clipBounds = projectData.clipBounds[i]
      this._vao.draw(gl.TRIANGLES, this._vertexCount)
    }

    this._vao.unbind()
  }

  if(projectData.showContour) {
    var shader = this._contourPickShader

    shader.bind()
    shader.uniforms = uniforms

    var vao = this._contourVAO
    vao.bind()

    for(var j=0; j<3; ++j) {
      gl.lineWidth(this.contourWidth[j])
      shader.uniforms.permutation = PERMUTATIONS[j]
      for(var i=0; i<this.contourLevels[j].length; ++i) {
        shader.uniforms.height = this.contourLevels[j][i]
        vao.draw(gl.LINES, this._contourCounts[j][i], this._contourOffsets[j][i])
      }
    }

    //Draw projections of surface
    for(var i=0; i<3; ++i) {
      if(!this.contourProject[i]) {
        continue
      }
      shader.uniforms.model      = projectData.projections[i]
      shader.uniforms.clipBounds = projectData.clipBounds[i]
      
      for(var j=0; j<3; ++j) {
        shader.uniforms.permutation = PERMUTATIONS[j]
        gl.lineWidth(this.contourWidth[j])
        for(var k=0; k<this.contourLevels[j].length; ++k) {
          shader.uniforms.height = this.contourLevels[j][k]
          vao.draw(gl.LINES, this._contourCounts[j][k], this._contourOffsets[j][k])
        }
      }
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

  //Compute uv coordinate
  var x = shape[0] * (selection.value[0] + (selection.value[2]>>4)/16.0)/255.0
  var ix = Math.floor(x)
  var fx = x - ix

  var y = shape[1] * (selection.value[1] + (selection.value[2]&15)/16.0)/255.0
  var iy = Math.floor(y)
  var fy = y - iy

  ix += 1
  iy += 1

  //Compute xyz coordinate
  var pos = [0,0,0]
  for(var dx=0; dx<2; ++dx) {
    var s = dx ? fx : 1.0 - fx
    for(var dy=0; dy<2; ++dy) {
      var t = dy ? fy : 1.0 - fy

      var r = ix + dx
      var c = iy + dy
      var w = s * t

      for(var i=0; i<3; ++i) {
        pos[i] += this._field[i].get(r,c) * w
      }
    }
  }

  //Find closest level
  var levelIndex = [-1,-1,-1]
  for(var j=0; j<3; ++j) {
    levelIndex[j] = bsearch.le(this.contourLevels[j], pos[j])
    if(levelIndex[j] < 0) {
      if(this.contourLevels[j].length > 0) {
        levelIndex[j] = 0
      }
    } else if(levelIndex[j] < this.contourLevels[j].length-1) {
      var a = this.contourLevels[j][levelIndex[j]]
      var b = this.contourLevels[j][levelIndex[j]+1]
      if(Math.abs(a-pos[j]) > Math.abs(b-pos[j])) {
        levelIndex[j] += 1
      }
    }
  }

  //Retrun resulting pick point
  return new SurfacePickResult(
    pos,
    [ fx<0.5 ? ix : (ix+1),
      fy<0.5 ? iy : (iy+1) ],
    [ x/shape[0], y/shape[1] ],
    levelIndex)
}

function padField(nfield, field) {

  var shape = field.shape.slice()
  var nshape = nfield.shape.slice()

  //Center
  ops.assign(nfield.lo(1,1).hi(shape[0], shape[1]), field)

  //Edges
  ops.assign(nfield.lo(1).hi(shape[0], 1), 
              field.hi(shape[0], 1))
  ops.assign(nfield.lo(1,nshape[1]-1).hi(shape[0],1),
              field.lo(0,shape[1]-1).hi(shape[0],1))
  ops.assign(nfield.lo(0,1).hi(1,shape[1]),
              field.hi(1))
  ops.assign(nfield.lo(nshape[0]-1,1).hi(1,shape[1]),
              field.lo(shape[0]-1))
  //Corners
  nfield.set(0,0, field.get(0,0))
  nfield.set(0,nshape[1]-1, field.get(0,shape[1]-1))
  nfield.set(nshape[0]-1,0, field.get(shape[0]-1,0))
  nfield.set(nshape[0]-1,nshape[1]-1, field.get(shape[0]-1,shape[1]-1))
}

function handleArray(param, ctor) {
  if(Array.isArray(param)) {
    return [ ctor(param[0]), ctor(param[1]), ctor(param[2]) ]
  }
  return [ ctor(param), ctor(param), ctor(param) ]
}

function toColor(x) {
  if(Array.isArray(x)) {
    if(x.length === 3) {
      return [x[0], x[1], x[2], 1]
    }
    return [x[0], x[1], x[2], x[3]]
  }
  return [0,0,0,1]
}

function handleColor(param) {
  if(Array.isArray(param)) {
    if(Array.isArray(param)) {
      return [  toColor(param[0]), 
                toColor(param[1]),
                toColor(param[2]) ]
    } else {
      var c = toColor(param)
      return [ 
        c.slice(), 
        c.slice(), 
        c.slice() ]
    }
  }
}

proto.update = function(params) {
  params = params || {}

  if('pickId' in params) {
    this.pickId = params.pickId|0
  }
  if('levels' in params) {
    var levels = params.levels
    if(!Array.isArray(levels[0])) {
      this.contourLevels = [ [], [], levels ]
    } else {
      this.contourLevels = levels.slice()
    }
    for(var i=0; i<3; ++i) {
      this.contourLevels[i] = this.contourLevels[i].slice()
      this.contourLevels.sort(function(a,b) {
        return a-b
      })
    }
  }
  if('contourWidth' in params) {
    this.contourWidth = handleArray(params.contourWidth, Number)
  }
  if('showContour' in params) {
    this.showContour = handleArray(params.showContour, Boolean)
  }
  if('showSurface' in params) {
    this.showSurface = !!params.showSurface
  }
  if('contourTint' in params) {
    this.contourTint = handleArray(params.contourTint, Boolean)
  }
  if('contourColor' in params) {
    this.contourColor = handleColor(params.contourColor)
  }
  if('contourProject' in params) {
    this.contourProject = handleArray(params.contourProject, Boolean)
  }
  if('surfaceProject' in params) {
    this.surfaceProject = params.surfaceProject
  }
  if('axesBounds' in params) {
    this.axesBounds = params.axesBounds
  }
  if(!params.field) {
    throw new Error('must specify field parameter')
  }
  if('dynamicColor' in params) {
    this.dynamicColor = handleColor(params.dynamicColor)
  }
  if('dynamicTint' in params) {
    this.dynamicTint = handleArray(params.dynamicTint, Number)
  }
  if('dynamicWidth' in params) {
    this.dynamicWidth = handleArray(params.dynamicWidth, Number)
  }

  //
  var field = params.field
  var fsize = (field.shape[0]+2)*(field.shape[1]+2)

  //Resize if necessary
  if(fsize > this._field[2].data.length) {
    pool.freeFloat(this._field[2].data)
    this._field[2].data = pool.mallocFloat(bits.nextPow2(fsize))
  }

  //Pad field
  this._field[2] = ndarray(this._field[2].data, [field.shape[0]+2, field.shape[1]+2])
  padField(this._field[2], field)

  //Save shape of field
  this.shape = field.shape.slice()

  //Save shape
  var shape = this.shape

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
      padField(this._field[i], coord)
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
      padField(this._field[i], tick2)
    }    
  } else {
    for(var i=0; i<2; ++i) {
      var offset = [0,0]
      offset[i] = 1
      this._field[i] = ndarray(this._field[i].data, shape, offset, 0)
    }
    for(var j=0; j<shape[0]; ++j) {
      this._field[0].set(j,0,j)
    }
    for(var j=0; j<shape[1]; ++j) {
      this._field[1].set(0,j,j)
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
            var f = this._field[k].get(1+i+dx, 1+j+dy)
            if(isNaN(f) || !isFinite(f)) {
              continue j_loop
            }
          }
        }
      }
      for(var k=0; k<6; ++k) {
        var r = i + QUAD[k][0]
        var c = j + QUAD[k][1]

        var tx = this._field[0].get(r+1, c+1)
        var ty = this._field[1].get(r+1, c+1)
        var f  = this._field[2].get(r+1, c+1)

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
  var contourVerts = []

  for(var dim=0; dim<3; ++dim) {
    var levels = this.contourLevels[dim]
    var levelOffsets = []
    var levelCounts  = []

    var parts = [0,0]
    var graphParts = [0,0]

    for(var i=0; i<levels.length; ++i) {
      var graph = surfaceNets(this._field[dim], levels[i])
      levelOffsets.push((contourVerts.length/4)|0)
      var vertexCount = 0

edge_loop:
      for(var j=0; j<graph.cells.length; ++j) {
        var e = graph.cells[j]
        for(var k=0; k<2; ++k) {
          var p = graph.positions[e[k]]

          var x = p[0]
          var ix = Math.floor(x)|0
          var fx = x - ix

          var y = p[1]
          var iy = Math.floor(y)|0
          var fy = y - iy

          var hole = false
dd_loop:
          for(var dd=0; dd<2; ++dd) {
            parts[dd] = 0.0
            var iu = (dim + dd + 1) % 3            
            for(var dx=0; dx<2; ++dx) {
              var s = dx ? fx : 1.0 - fx
              var r = Math.min(Math.max(ix+dx, 0), shape[0])|0
              for(var dy=0; dy<2; ++dy) {
                var t = dy ? fy : 1.0 - fy
                var c = Math.min(Math.max(iy+dy, 0), shape[1])|0

                var f = this._field[iu].get(r,c)
                if(!isFinite(f) || isNaN(f)) {
                  hole = true
                  break dd_loop
                }

                var w = s * t
                parts[dd] += w * f
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

    //Store results
    this._contourOffsets[dim]  = levelOffsets
    this._contourCounts[dim]   = levelCounts
  }

  var floatBuffer = pool.mallocFloat(contourVerts.length)
  for(var i=0; i<contourVerts.length; ++i) {
    floatBuffer[i] = contourVerts[i]
  }
  this._contourBuffer.update(floatBuffer)
  pool.freeFloat(floatBuffer)

  if(typeof params.colormap === "string") {
    this._colorMap.setPixels(genColormap(params.colormap))
  } else if(Array.isArray(params.colormap)) {
    //Set colormap
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
  this._dynamicBuffer.dispose()
  this._dynamicVAO.dispose()
  for(var i=0; i<3; ++i) {
    pool.freeFloat(this._field[i].data)
  }
}

proto.dynamic = function(levels) {
  var vertexCount = 0
  var shape = this.shape
  var scratchBuffer = pool.mallocFloat(12 * shape[0] * shape[1]) 
  this.dynamicLevel = levels.slice()

  for(var d=0; d<3; ++d) {
    var u = (d+1) % 3
    var v = (d+2) % 3

    var f = this._field[d]
    var g = this._field[u]
    var h = this._field[v]

    var graph     = surfaceNets(f, levels[d])
    var edges     = graph.cells
    var positions = graph.positions

    this._dynamicOffsets[d] = vertexCount

    for(var i=0; i<edges.length; ++i) {
      var e = edges[i]
      for(var j=0; j<2; ++j) {
        var p  = positions[e[j]]

        var x  = +Math.max(Math.min(p[0], shape[0]), 1.0)
        var ix = x|0
        var fx = x - ix
        var hx = 1.0 - fx
        
        var y  = +Math.max(Math.min(p[1], shape[1]), 1.0)
        var iy = y|0
        var fy = y - iy
        var hy = 1.0 - fy
        
        var w00 = hx * hy
        var w01 = hx * fy
        var w10 = fx * hy
        var w11 = fx * fy

        var cu =  w00 * g.get(ix,  iy) +
                  w01 * g.get(ix,  iy+1) +
                  w10 * g.get(ix+1,iy) +
                  w11 * g.get(ix+1,iy+1)

        var cv =  w00 * h.get(ix,  iy) +
                  w01 * h.get(ix,  iy+1) +
                  w10 * h.get(ix+1,iy) +
                  w11 * h.get(ix+1,iy+1)

        if(isNaN(cu) || isNaN(cv)) {
          if(j) {
            vertexCount -= 1
          }
          break
        }

        scratchBuffer[2*vertexCount+0] = cu
        scratchBuffer[2*vertexCount+1] = cv

        vertexCount += 1
      }
    }

    this._dynamicCounts[d] = vertexCount - this._dynamicOffsets[d]
  }

  this._dynamicBuffer.update(scratchBuffer.subarray(0, 2*vertexCount))
  pool.freeFloat(scratchBuffer)
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

  var dynamicBuffer = createBuffer(gl)
  var dynamicVAO = createVAO(gl, [
    {
      buffer: dynamicBuffer,
      size: 2,
      type: gl.FLOAT
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
    contourVAO,
    dynamicBuffer,
    dynamicVAO)

  var nparams = {}
  for(var id in params) {
    nparams[id] = params[id]
  }
  nparams.field = field
  nparams.colormap = nparams.colormap || 'jet'

  surface.update(nparams)

  return surface
}