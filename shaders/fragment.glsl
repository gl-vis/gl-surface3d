precision mediump float;

#pragma glslify: beckmann = require(glsl-specular-beckmann)

uniform vec3 lowerBound, upperBound;
uniform float contourTint;
uniform vec4 contourColor;
uniform sampler2D colormap;
uniform vec3 clipBounds[2];
uniform float roughness, fresnel, kambient, kdiffuse, kspecular, opacity;

varying float value, kill;
varying vec3 worldCoordinate;
varying vec3 lightDirection, eyeDirection, surfaceNormal;

void main() {
  if(kill > 0.0 ||
    any(lessThan(worldCoordinate, clipBounds[0])) || any(greaterThan(worldCoordinate, clipBounds[1]))) {
    discard;
  }

  vec3 N = normalize(surfaceNormal);
  vec3 V = normalize(eyeDirection);
  vec3 L = normalize(lightDirection);

  if(gl_FrontFacing) {
    N = -N;
  }

  float specular = beckmann(L, V, N, roughness);
  float diffuse  = min(kambient + kdiffuse * max(dot(N, L), 0.0), 1.0);

  vec4 surfaceColor = texture2D(colormap, vec2(value, value));
  vec4 litColor = surfaceColor.a * vec4(diffuse * surfaceColor.rgb + kspecular * vec3(1,1,1) * specular,  1.0);

  gl_FragColor = mix(litColor, contourColor, contourTint) * opacity;
}
