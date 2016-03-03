precision mediump float;

attribute vec4 uv;
attribute vec3 f;
attribute vec3 normal;

uniform mat4 model, view, projection, inverseModel;
uniform vec3 lightPosition, eyePosition;

varying float value, kill;
varying vec3 worldCoordinate;
varying vec2 planeCoordinate;
varying vec3 lightDirection, eyeDirection, surfaceNormal;

void main() {
  worldCoordinate = vec3(uv.zw, f.x);
  vec4 worldPosition = model * vec4(worldCoordinate, 1.0);
  vec4 clipPosition = projection * view * worldPosition;
  gl_Position = clipPosition;
  kill = f.y;
  value = f.z;
  planeCoordinate = uv.xy;

  //Lighting geometry parameters
  vec4 cameraCoordinate = view * worldPosition;
  cameraCoordinate.xyz /= cameraCoordinate.w;
  lightDirection = lightPosition - cameraCoordinate.xyz;
  eyeDirection   = eyePosition - cameraCoordinate.xyz;
  surfaceNormal  = normalize((vec4(normal,0) * inverseModel).xyz);
}
