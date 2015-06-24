var createShader  = require('gl-shader')
var glslify       = require('glslify')

var vertSrc = glslify('../shaders/vertex.glsl')
var fragSrc = glslify('../shaders/fragment.glsl')
var contourVertSrc = glslify('../shaders/contour-vertex.glsl')
var pickSrc = glslify('../shaders/pick.glsl')

exports.createShader = function(gl) {
  var shader = createShader(gl, vertSrc, fragSrc)
  shader.attributes.uv.location = 0
  shader.attributes.f.location = 1
  shader.attributes.normal.location = 2
  return shader
}
exports.createPickShader = function(gl) {
  var shader = createShader(gl, vertSrc, pickSrc)
  shader.attributes.uv.location = 0
  shader.attributes.f.location = 1
  shader.attributes.normal.location = 2
  return shader
}
exports.createContourShader = function(gl) {
  var shader = createShader(gl, contourVertSrc, fragSrc)
  shader.attributes.uv.location = 0
  return shader
}
exports.createPickContourShader = function(gl) {
  var shader = createShader(gl, contourVertSrc, pickSrc)
  shader.attributes.uv.location = 0
  return shader
}
