/*
 * Copyright (C) 2013 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
Layers.LayerTreeModel = class extends SDK.SDKModel {
  constructor(target) {
    super(Layers.LayerTreeModel, target);
    target.registerLayerTreeDispatcher(new Layers.LayerTreeDispatcher(this));
    SDK.targetManager.addEventListener(SDK.TargetManager.Events.MainFrameNavigated, this._onMainFrameNavigated, this);
    /** @type {?SDK.LayerTreeBase} */
    this._layerTree = null;
  }

  /**
   * @param {!SDK.Target} target
   * @return {?Layers.LayerTreeModel}
   */
  static fromTarget(target) {
    if (!target.hasDOMCapability())
      return null;

    var model = target.model(Layers.LayerTreeModel);
    if (!model)
      model = new Layers.LayerTreeModel(target);
    return model;
  }

  disable() {
    if (!this._enabled)
      return;
    this._enabled = false;
    this.target().layerTreeAgent().disable();
  }

  enable() {
    if (this._enabled)
      return;
    this._enabled = true;
    this._forceEnable();
  }

  _forceEnable() {
    this._lastPaintRectByLayerId = {};
    if (!this._layerTree)
      this._layerTree = new Layers.AgentLayerTree(this.target());
    this.target().layerTreeAgent().enable();
  }

  /**
   * @return {?SDK.LayerTreeBase}
   */
  layerTree() {
    return this._layerTree;
  }

  /**
   * @param {?Array.<!Protocol.LayerTree.Layer>} layers
   */
  _layerTreeChanged(layers) {
    if (!this._enabled)
      return;
    var layerTree = /** @type {!Layers.AgentLayerTree} */ (this._layerTree);
    layerTree.setLayers(layers, onLayersSet.bind(this));

    /**
     * @this {Layers.LayerTreeModel}
     */
    function onLayersSet() {
      for (var layerId in this._lastPaintRectByLayerId) {
        var lastPaintRect = this._lastPaintRectByLayerId[layerId];
        var layer = layerTree.layerById(layerId);
        if (layer)
          layer._lastPaintRect = lastPaintRect;
      }
      this._lastPaintRectByLayerId = {};

      this.dispatchEventToListeners(Layers.LayerTreeModel.Events.LayerTreeChanged);
    }
  }

  /**
   * @param {!Protocol.LayerTree.LayerId} layerId
   * @param {!Protocol.DOM.Rect} clipRect
   */
  _layerPainted(layerId, clipRect) {
    if (!this._enabled)
      return;
    var layerTree = /** @type {!Layers.AgentLayerTree} */ (this._layerTree);
    var layer = layerTree.layerById(layerId);
    if (!layer) {
      this._lastPaintRectByLayerId[layerId] = clipRect;
      return;
    }
    layer._didPaint(clipRect);
    this.dispatchEventToListeners(Layers.LayerTreeModel.Events.LayerPainted, layer);
  }

  _onMainFrameNavigated() {
    this._layerTree = null;
    if (this._enabled)
      this._forceEnable();
  }
};

/** @enum {symbol} */
Layers.LayerTreeModel.Events = {
  LayerTreeChanged: Symbol('LayerTreeChanged'),
  LayerPainted: Symbol('LayerPainted'),
};

/**
 * @unrestricted
 */
Layers.AgentLayerTree = class extends SDK.LayerTreeBase {
  /**
   * @param {?SDK.Target} target
   */
  constructor(target) {
    super(target);
  }

  /**
   * @param {?Array.<!Protocol.LayerTree.Layer>} payload
   * @param {function()} callback
   */
  setLayers(payload, callback) {
    if (!payload) {
      onBackendNodeIdsResolved.call(this);
      return;
    }

    var idsToResolve = new Set();
    for (var i = 0; i < payload.length; ++i) {
      var backendNodeId = payload[i].backendNodeId;
      if (!backendNodeId || this.backendNodeIdToNode().has(backendNodeId))
        continue;
      idsToResolve.add(backendNodeId);
    }
    this.resolveBackendNodeIds(idsToResolve, onBackendNodeIdsResolved.bind(this));

    /**
     * @this {Layers.AgentLayerTree}
     */
    function onBackendNodeIdsResolved() {
      this._innerSetLayers(payload);
      callback();
    }
  }

  /**
   * @param {?Array.<!Protocol.LayerTree.Layer>} layers
   */
  _innerSetLayers(layers) {
    this.setRoot(null);
    this.setContentRoot(null);
    // Payload will be null when not in the composited mode.
    if (!layers)
      return;
    var root;
    var oldLayersById = this._layersById;
    this._layersById = {};
    for (var i = 0; i < layers.length; ++i) {
      var layerId = layers[i].layerId;
      var layer = oldLayersById[layerId];
      if (layer)
        layer._reset(layers[i]);
      else
        layer = new Layers.AgentLayer(this.target(), layers[i]);
      this._layersById[layerId] = layer;
      var backendNodeId = layers[i].backendNodeId;
      if (backendNodeId)
        layer._setNode(this.backendNodeIdToNode().get(backendNodeId));
      if (!this.contentRoot() && layer.drawsContent())
        this.setContentRoot(layer);
      var parentId = layer.parentId();
      if (parentId) {
        var parent = this._layersById[parentId];
        if (!parent)
          console.assert(parent, 'missing parent ' + parentId + ' for layer ' + layerId);
        parent.addChild(layer);
      } else {
        if (root)
          console.assert(false, 'Multiple root layers');
        root = layer;
      }
    }
    if (root) {
      this.setRoot(root);
      root._calculateQuad(new WebKitCSSMatrix());
    }
  }
};

/**
 * @implements {SDK.Layer}
 * @unrestricted
 */
Layers.AgentLayer = class {
  /**
   * @param {?SDK.Target} target
   * @param {!Protocol.LayerTree.Layer} layerPayload
   */
  constructor(target, layerPayload) {
    this._target = target;
    this._reset(layerPayload);
  }

  /**
   * @override
   * @return {string}
   */
  id() {
    return this._layerPayload.layerId;
  }

  /**
   * @override
   * @return {?string}
   */
  parentId() {
    return this._layerPayload.parentLayerId;
  }

  /**
   * @override
   * @return {?SDK.Layer}
   */
  parent() {
    return this._parent;
  }

  /**
   * @override
   * @return {boolean}
   */
  isRoot() {
    return !this.parentId();
  }

  /**
   * @override
   * @return {!Array.<!SDK.Layer>}
   */
  children() {
    return this._children;
  }

  /**
   * @override
   * @param {!SDK.Layer} child
   */
  addChild(child) {
    if (child._parent)
      console.assert(false, 'Child already has a parent');
    this._children.push(child);
    child._parent = this;
  }

  /**
   * @param {?SDK.DOMNode} node
   */
  _setNode(node) {
    this._node = node;
  }

  /**
   * @override
   * @return {?SDK.DOMNode}
   */
  node() {
    return this._node;
  }

  /**
   * @override
   * @return {?SDK.DOMNode}
   */
  nodeForSelfOrAncestor() {
    for (var layer = this; layer; layer = layer._parent) {
      if (layer._node)
        return layer._node;
    }
    return null;
  }

  /**
   * @override
   * @return {number}
   */
  offsetX() {
    return this._layerPayload.offsetX;
  }

  /**
   * @override
   * @return {number}
   */
  offsetY() {
    return this._layerPayload.offsetY;
  }

  /**
   * @override
   * @return {number}
   */
  width() {
    return this._layerPayload.width;
  }

  /**
   * @override
   * @return {number}
   */
  height() {
    return this._layerPayload.height;
  }

  /**
   * @override
   * @return {?Array.<number>}
   */
  transform() {
    return this._layerPayload.transform;
  }

  /**
   * @override
   * @return {!Array.<number>}
   */
  quad() {
    return this._quad;
  }

  /**
   * @override
   * @return {!Array.<number>}
   */
  anchorPoint() {
    return [
      this._layerPayload.anchorX || 0,
      this._layerPayload.anchorY || 0,
      this._layerPayload.anchorZ || 0,
    ];
  }

  /**
   * @override
   * @return {boolean}
   */
  invisible() {
    return this._layerPayload.invisible;
  }

  /**
   * @override
   * @return {number}
   */
  paintCount() {
    return this._paintCount || this._layerPayload.paintCount;
  }

  /**
   * @override
   * @return {?Protocol.DOM.Rect}
   */
  lastPaintRect() {
    return this._lastPaintRect;
  }

  /**
   * @override
   * @return {!Array.<!Protocol.LayerTree.ScrollRect>}
   */
  scrollRects() {
    return this._scrollRects;
  }

  /**
   * @override
   * @param {function(!Array.<string>)} callback
   */
  requestCompositingReasons(callback) {
    if (!this._target) {
      callback([]);
      return;
    }

    var wrappedCallback = InspectorBackend.wrapClientCallback(
        callback, 'Protocol.LayerTree.reasonsForCompositingLayer(): ', undefined, []);
    this._target.layerTreeAgent().compositingReasons(this.id(), wrappedCallback);
  }

  /**
   * @override
   * @return {boolean}
   */
  drawsContent() {
    return this._layerPayload.drawsContent;
  }

  /**
   * @override
   * @return {number}
   */
  gpuMemoryUsage() {
    /**
     * @const
     */
    var bytesPerPixel = 4;
    return this.drawsContent() ? this.width() * this.height() * bytesPerPixel : 0;
  }

  /**
   * @override
   * @return {!Array<!Promise<?SDK.SnapshotWithRect>>}
   */
  snapshots() {
    var rect = {x: 0, y: 0, width: this.width(), height: this.height()};
    var promise = this._target.layerTreeAgent().makeSnapshot(
        this.id(), (error, snapshotId) => error || !this._target ?
            null :
            {rect: rect, snapshot: new SDK.PaintProfilerSnapshot(this._target, snapshotId)});
    return [promise];
  }

  /**
   * @param {!Protocol.DOM.Rect} rect
   */
  _didPaint(rect) {
    this._lastPaintRect = rect;
    this._paintCount = this.paintCount() + 1;
    this._image = null;
  }

  /**
   * @param {!Protocol.LayerTree.Layer} layerPayload
   */
  _reset(layerPayload) {
    /** @type {?SDK.DOMNode} */
    this._node = null;
    this._children = [];
    this._parent = null;
    this._paintCount = 0;
    this._layerPayload = layerPayload;
    this._image = null;
    this._scrollRects = this._layerPayload.scrollRects || [];
  }

  /**
   * @param {!Array.<number>} a
   * @return {!CSSMatrix}
   */
  _matrixFromArray(a) {
    function toFixed9(x) {
      return x.toFixed(9);
    }
    return new WebKitCSSMatrix('matrix3d(' + a.map(toFixed9).join(',') + ')');
  }

  /**
   * @param {!CSSMatrix} parentTransform
   * @return {!CSSMatrix}
   */
  _calculateTransformToViewport(parentTransform) {
    var offsetMatrix = new WebKitCSSMatrix().translate(this._layerPayload.offsetX, this._layerPayload.offsetY);
    var matrix = offsetMatrix;

    if (this._layerPayload.transform) {
      var transformMatrix = this._matrixFromArray(this._layerPayload.transform);
      var anchorVector = new Common.Geometry.Vector(
          this._layerPayload.width * this.anchorPoint()[0], this._layerPayload.height * this.anchorPoint()[1],
          this.anchorPoint()[2]);
      var anchorPoint = Common.Geometry.multiplyVectorByMatrixAndNormalize(anchorVector, matrix);
      var anchorMatrix = new WebKitCSSMatrix().translate(-anchorPoint.x, -anchorPoint.y, -anchorPoint.z);
      matrix = anchorMatrix.inverse().multiply(transformMatrix.multiply(anchorMatrix.multiply(matrix)));
    }

    matrix = parentTransform.multiply(matrix);
    return matrix;
  }

  /**
   * @param {number} width
   * @param {number} height
   * @return {!Array.<number>}
   */
  _createVertexArrayForRect(width, height) {
    return [0, 0, 0, width, 0, 0, width, height, 0, 0, height, 0];
  }

  /**
   * @param {!CSSMatrix} parentTransform
   */
  _calculateQuad(parentTransform) {
    var matrix = this._calculateTransformToViewport(parentTransform);
    this._quad = [];
    var vertices = this._createVertexArrayForRect(this._layerPayload.width, this._layerPayload.height);
    for (var i = 0; i < 4; ++i) {
      var point = Common.Geometry.multiplyVectorByMatrixAndNormalize(
          new Common.Geometry.Vector(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]), matrix);
      this._quad.push(point.x, point.y);
    }

    function calculateQuadForLayer(layer) {
      layer._calculateQuad(matrix);
    }

    this._children.forEach(calculateQuadForLayer);
  }
};

/**
 * @implements {Protocol.LayerTreeDispatcher}
 * @unrestricted
 */
Layers.LayerTreeDispatcher = class {
  /**
   * @param {!Layers.LayerTreeModel} layerTreeModel
   */
  constructor(layerTreeModel) {
    this._layerTreeModel = layerTreeModel;
  }

  /**
   * @override
   * @param {!Array.<!Protocol.LayerTree.Layer>=} layers
   */
  layerTreeDidChange(layers) {
    this._layerTreeModel._layerTreeChanged(layers || null);
  }

  /**
   * @override
   * @param {!Protocol.LayerTree.LayerId} layerId
   * @param {!Protocol.DOM.Rect} clipRect
   */
  layerPainted(layerId, clipRect) {
    this._layerTreeModel._layerPainted(layerId, clipRect);
  }
};
