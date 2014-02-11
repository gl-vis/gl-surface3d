gl-surface-plot
===============
Draws a surface plot

## Example

```javascript
var shell = require("gl-now")({ clearColor: [0,0,0,0] })
var camera = require("game-shell-orbit-camera")(shell)
var createSurfacePlot = require("gl-surface-plot")
var ndarray = require("ndarray")
var fill = require("ndarray-fill")
var diric = require("dirichlet")
var glm = require("gl-matrix")
var mat4 = glm.mat4

var surface

shell.on("gl-init", function() {
  var gl = shell.gl
  gl.enable(gl.DEPTH_TEST)

  //Set up camera
  camera.lookAt(
    [0, 0, 2],      //Eye position
    [256, 256, 64], //Eye target
    [0, 0, 1])      //Up direction

  //Create field
  var field = ndarray(new Float32Array(512*512), [512,512])
  fill(field, function(x,y) {
    return 128 * diric(10, 10.0*(x-256)/512) * diric(10, 10.0*(y-256)/512)
  })
  surface = createSurface(gl, field)
})

shell.on("gl-render", function() {
  surface.draw({
    view: camera.view(),
    projection:  mat4.perspective(new Array(16), Math.PI/4.0, shell.width/shell.height, 0.1, 10000.0)
  })
})
```

Here is what this should look like:

<img src="plot.png">

[Test it in your browser (requires WebGL)](http://mikolalysenko.github.io/gl-surface-plot/)

## Install

```
npm install gl-surface-plot
```

## API

```javascript
var createSurfacePlot = require("gl-surface-plot")
```

### `var surface = createSurfacePlot(gl, field[, params])`
Creates a surface plot object

* `gl` is a WebGL context
* `field` is a 2D ndarray
* `params` is an optional collection of arguments that contains any of the following:

    + `colormap` - the name of the color map to use for the surface (default "jet")

**Returns** A surface object

### `surface.update(params)`
Updates the surface.  The parameter object may contain any of the following properties:

* `field` a new 2D field encoded as an ndarray
* `colormap` the name of the new color map for the surface

### `surface.draw([params])`
Draws the surface.  Accepts the following parameters

* `model` the 4x4 model matrix (in gl-matrix format)
* `view` the 4x4 view matrix
* `projection` the 4x4 projection matrix

### `surface.dispose()`
Destroys the surface, releases all associated WebGL resources

### `surface.bounds`
A pair of 3D arrays representing the lower/upper bounding box for the surface plot.

## License
MIT License.