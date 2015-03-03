var createShader  = require('gl-shader')
var glslify       = require('glslify')

var forward = glslify({
    vertex:   '../shaders/vertex.glsl',
    fragment: '../shaders/fragment.glsl',
    sourceOnly: true
  }),
  contour = glslify({
    vertex:   '../shaders/contour-vertex.glsl',
    fragment: '../shaders/fragment.glsl',
    sourceOnly: true
  }),
  pick = glslify({
    vertex:   '../shaders/vertex.glsl',
    fragment: '../shaders/pick.glsl',
    sourceOnly: true
  }),
  pickContour = glslify({
    vertex:   '../shaders/contour-vertex.glsl',
    fragment: '../shaders/pick.glsl',
    sourceOnly: true
  })

exports.createShader = function(gl) {
  var shader = createShader(gl, forward)
  shader.attributes.uv.location = 0
  shader.attributes.f.location = 1
  shader.attributes.normal.location = 2
  return shader
}
exports.createPickShader = function(gl) {
  var shader = createShader(gl, pick)
  shader.attributes.uv.location = 0
  shader.attributes.f.location = 1
  shader.attributes.normal.location = 2
  return shader
}
exports.createContourShader = function(gl) {
  var shader = createShader(gl, contour)
  shader.attributes.uv.location = 0
  return shader
}
exports.createPickContourShader = function(gl) {
  var shader = createShader(gl, pickContour)
  shader.attributes.uv.location = 0
  return shader
}