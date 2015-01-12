﻿/*global define,dojo,alert */
/*jslint browser:true,sloppy:true,nomen:true,unparam:true,plusplus:true,indent:4 */
define([
    "dojo/_base/declare",
    "dojo/dom-construct",
    "dojo/_base/lang",
    "dojo/dom-attr",
    "dojo/dom-class",
    "dojo/dom-geometry",
    "dojo/dom-style",
    "dojo/_base/array",
    "dojo/dom",
    "dojo/Deferred",
    "dojo/DeferredList",
    "dojo/on",
    "dojo/query",
    "dojo/text!./templates/locator.html",
    "dijit/_WidgetBase",
    "dijit/_TemplatedMixin",
    "dijit/_WidgetsInTemplateMixin",
    "esri/Color",
    "esri/config",
    "esri/graphic",
    "esri/geometry/Point",
    "esri/geometry/webMercatorUtils",
    "esri/layers/GraphicsLayer",
    "esri/SpatialReference",
    "esri/tasks/GeometryService",
    "esri/tasks/locator",
    "esri/tasks/ProjectParameters",
    "esri/tasks/query",
    "esri/tasks/QueryTask",
    "vendor/usng"
], function (declare, domConstruct, lang, domAttr, domClass, domGeom, domStyle, array, dom, Deferred, DeferredList, on, query, template, _WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin, Color, esriConfig, Graphic, Point, webMercatorUtils, GraphicsLayer, SpatialReference, GeometryService, Locator, ProjectParameters, EsriQuery, QueryTask, usng) {
    return declare([_WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin], {
        templateString: template,
        lastSearchString: null,
        stagedSearch: null,
        usngValue: null,
        mgrsValue: null,
        latLongValue: null,

        /**
        * This function is called when widget is constructed.
        * @param{object} config to be mixed
        * @memberOf widgets/locator/locator
        */
        constructor: function (config) {
            lang.mixin(this, config);
        },

        /**
        * Initialize widget
        * @memberOf widgets/locator/locator
        */
        postCreate: function () {
            var graphicsLayer;
            domConstruct.place(this.divLocateContainer, query(".esriCTlocationPanel")[0]);
            domAttr.set(this.txtSearch, "placeholder", dojo.configData.i18n.locator.locatorPlaceholder);
            this._attachLocatorEvents();
            // add graphics layer to map
            graphicsLayer = new GraphicsLayer();
            graphicsLayer.id = "locatorGraphicsLayer";
            this.map.addLayer(graphicsLayer);
        },

        /**
        * attach locator events
        * @memberOf widgets/locator/locator
        */
        _attachLocatorEvents: function () {
            // perform unified search when user clicks on the locate button
            on(this.searchSubmit, 'click', lang.hitch(this, function () {
                if (lang.trim(this.txtSearch.value) !== '') {
                    this._toggleTexBoxControls(false);
                    //replace the staged search
                    clearTimeout(this.stagedSearch);
                    this._performUnifiedSearch();
                }
            }));
            on(this.txtSearch, "keyup", lang.hitch(this, function (evt) {
                this._submitAddress(evt);
            }));
            on(this.txtSearch, "paste", lang.hitch(this, function (evt) {
                this._submitAddress(evt, true);
            }));
            on(this.txtSearch, "cut", lang.hitch(this, function (evt) {
                this._submitAddress(evt, true);
            }));
            on(this.close, "click", lang.hitch(this, function () {
                this._hideText();
            }));
        },

        /**
        * search address on every key press
        * @memberOf widgets/locator/locator
        * @param {object} evt Keyup event
        * @param {} locatorText
        */
        _submitAddress: function (evt, locatorText) {
            if (locatorText) {
                setTimeout(lang.hitch(this, function () {
                    this._performUnifiedSearch();
                }), 100);
                return;
            }
            if (evt) {
            // Perform search when user hits ENTER key
                if (evt.keyCode === dojo.keys.ENTER) {
                    if (this.txtSearch.value !== '') {
                        this._toggleTexBoxControls(true);
                        this._performUnifiedSearch();
                        return;
                    }
                }
                // Clear address results container when user hits BACKSPACE key till search box becomes empty
                if (evt.keyCode === dojo.keys.BACKSPACE) {
                    if (this.txtSearch.value === '' || this.txtSearch.length === 0 || this.txtSearch.value === null) {
                        this._toggleTexBoxControls(false);
                        domConstruct.empty(this.divResultContainer);
                        domClass.add(this.divResultContainer, "esriCTHidden");
                        return;
                    }
                }

                /**
                * do not perform auto complete search if alphabets,
                * numbers,numpad keys,comma,ctl+v,ctrl +x,delete or
                * backspace is pressed
                */
                if ((!((evt.keyCode >= 46 && evt.keyCode < 58) || (evt.keyCode > 64 && evt.keyCode < 91) || (evt.keyCode > 95 && evt.keyCode < 106) || evt.keyCode === 8 || evt.keyCode === 110 || evt.keyCode === 188)) || (evt.keyCode === 86 && evt.ctrlKey) || (evt.keyCode === 88 && evt.ctrlKey)) {
                    evt.cancelBubble = true;
                    if (evt.stopPropagation) {
                        evt.stopPropagation();
                    }
                    this._toggleTexBoxControls(false);
                    return;
                }
                /**
                * call locator service if search text is not empty
                */
                if (lang.trim(this.txtSearch.value) !== '') {
                    if (this.lastSearchString !== lang.trim(this.txtSearch.value)) {
                        this.lastSearchString = lang.trim(this.txtSearch.value);
                        domConstruct.empty(this.divResultContainer);

                        /**
                        * clear any staged search
                        */
                        clearTimeout(this.stagedSearch);
                        if (lang.trim(this.txtSearch.value).length > 0) {

                            /**
                            * stage a new search, which will launch if no new searches show up
                            * before the timeout
                            */
                            this.stagedSearch = setTimeout(lang.hitch(this, function () {
                                this.stagedSearch = this._performUnifiedSearch();
                            }), 500);
                        }
                    } else {
                        this._toggleTexBoxControls(false);
                    }
                } else {
                    this.lastSearchString = lang.trim(this.txtSearch.value);
                    this._toggleTexBoxControls(false);
                    domConstruct.empty(this.divResultContainer);
                    domClass.add(this.divResultContainer, "esriCTHidden");
                }
            }
        },

        /**
        * Perform unified search
        * @method widgets/locator/locator
        */
        _performUnifiedSearch: function () {
            var layer, deferred, deferredArray = [], i, address, options, locator, locatorDef;
            this.usngValue = null;
            this.mgrsValue = null;
            this.latLongValue = null;
            this._toggleTexBoxControls(true);
            // fetch the geocode URL from portal organization, and if the URL is unavailable disable address search
            if (dojo.configData.helperServices.geocode.length > 0) {
                locator = new Locator(dojo.configData.helperServices.geocode[0].url);
                locator.outSpatialReference = this.map.spatialReference;
                address = {
                    SingleLine: this.txtSearch.value
                };
                options = {
                    address: address,
                    outFields: ["*"]
                };
                // optionally return the out fields if you need to calculate the extent of the geocoded point
                locatorDef = locator.addressToLocations(options);
                locator.on("address-to-locations-complete", lang.hitch(this, function (evt) {
                    deferred = new Deferred();
                    deferred.resolve(evt.addresses);
                    return deferred.promise;
                }));
                deferredArray.push(locatorDef);
            }
            // check if layer search is enabled in the webmap and layer is configured for search
            if (this.itemInfo.applicationProperties.viewing.search && this.itemInfo.applicationProperties.viewing.search.enabled) {
                for (i = 0; i < this.itemInfo.applicationProperties.viewing.search.layers.length; i++) {
                    if (this.layerId === this.itemInfo.applicationProperties.viewing.search.layers[i].id) {
                        this.searchField = this.itemInfo.applicationProperties.viewing.search.layers[i].field.name;
                        layer = this.map.getLayer(this.itemInfo.applicationProperties.viewing.search.layers[i].id);
                        this._layerSearchResults(this.itemInfo.applicationProperties.viewing.search.layers[i], deferredArray);
                    }
                }
            }
            // check if 'enableUSNGSearch' flag is set to true in config file
            if (dojo.configData.enableUSNGSearch) {
                this._convertUSNG();
            }
            // check if 'enableMGRSSearch' flag is set to true in config file
            if (dojo.configData.enableMGRSSearch) {
                this._convertMGRS();
            }
            // check if 'enableLatLongSearch' flag is set to true in config file
            if (dojo.configData.enableLatLongSearch) {
                this._getLatLongValue();
            }
            // get results for both address and layer search
            this._getAddressResults(deferredArray, layer);
        },

        /**
        * Perform layer search if it is enabled in the webmap
        * @method widgets/locator/locator
        * @param {} layerObject
        * @param {} deferredArray
        */
        _layerSearchResults: function (layerObject, deferredArray) {
            var queryTask, queryLayer, deferred, currentTime, queryURL;
            queryURL = this.map.getLayer(layerObject.id);
            this._toggleTexBoxControls(true);
            if (queryURL) {
                currentTime = new Date().getTime();
                queryTask = new QueryTask(queryURL.url);
                queryLayer = new EsriQuery();
                // check if layer is configured to perform exact search, else perform 'contains' search
                if (layerObject.field.exactMatch) {
                    queryLayer.where = layerObject.field.name.toUpperCase() + "='" + lang.trim(this.txtSearch.value).toUpperCase() + "'" + " AND " + currentTime + "=" + currentTime;
                } else {
                    queryLayer.where = layerObject.field.name.toUpperCase() + " LIKE '%" + lang.trim(this.txtSearch.value).toUpperCase() + "%'" + " AND " + currentTime + "=" + currentTime;
                }
                queryLayer.outSpatialReference = this.map.spatialReference;
                queryLayer.returnGeometry = true;
                queryLayer.outFields = ["*"];
                deferred = new Deferred();
                queryTask.execute(queryLayer, lang.hitch(this, function (featureSet) {
                    deferred.resolve(featureSet);
                }), function (err) {
                    alert(err.message);
                    deferred.reject();
                });
                deferredArray.push(deferred);
            }
        },

        /**
        * Fetch results for both address and layer search
        * @method widgets/locator/locator
        * @param {} deferredArray
        * @param {} layer on which search is performed
        */
        _getAddressResults: function (deferredArray, layer) {
            var deferredListResult, nameArray, num;
            this.resultLength = 0;
            deferredListResult = new DeferredList(deferredArray);
            deferredListResult.then(lang.hitch(this, function (result) {
                nameArray = {};
                domClass.remove(this.divResultContainer, "esriCTHidden");
                if (result) {
                    if (result.length > 0) {
                        for (num = 0; num < result.length; num++) {
                            if (result[num][0] === true) {
                                if (result[num][1].features) {
                                    this._displayLayerSearchResults(result[num][1], nameArray, layer);
                                } else {
                                    nameArray[dojo.configData.i18n.locator.addressText] = [];
                                    this._addressResult(result[num][1], nameArray);
                                }

                            }
                        }
                    }
                }
                // push USNG value into address array
                if (this.usngValue && this.usngValue.value) {
                    nameArray[dojo.configData.i18n.locator.usngText] = [];
                    nameArray[dojo.configData.i18n.locator.usngText].push(this.usngValue);
                    this.resultLength++;
                }
                // push MGRS value into address array
                if (this.mgrsValue && this.mgrsValue.value) {
                    nameArray[dojo.configData.i18n.locator.mgrsText] = [];
                    nameArray[dojo.configData.i18n.locator.mgrsText].push(this.mgrsValue);
                    this.resultLength++;
                }
                // push lat long value into address array
                if (this.latLongValue && this.latLongValue.value) {
                    nameArray[dojo.configData.i18n.locator.latLongText] = [];
                    nameArray[dojo.configData.i18n.locator.latLongText].push({ LatLong: this.latLongValue });
                    this.resultLength++;
                }
                this._showLocatedAddress(nameArray);
            }));
        },

        /**
        * Push address search results in address array
        * @param {} candidates
        * @memberOf widgets/locator/locator
        */
        _addressResult: function (candidates, nameArray) {
            var order;
            for (order = 0; order < candidates.length; order++) {
                if (candidates[order].attributes.Addr_type !== "LatLong") {
                    nameArray.Address.push({
                        name: candidates[order].address,
                        attributes: candidates[order]
                    });
                    this.resultLength++;
                }
            }
        },

        /**
        * Push layer search results in address array
        * @param {} candidates
        * @memberOf widgets/locator/locator
        */
        _displayLayerSearchResults: function (results, nameArray, layer) {
            var key, i, index, resultAttributes;
            key = layer.name;
            nameArray[key] = [];
            for (i = 0; i < results.features.length; i++) {
                resultAttributes = results.features[i].attributes;
                for (index in resultAttributes) {
                    if (resultAttributes.hasOwnProperty(index)) {
                        if (!resultAttributes[index]) {
                            resultAttributes[index] = dojo.configData.showNullValueAs;
                        }
                    }
                }
                nameArray[key].push({
                    name: resultAttributes[this.searchField],
                    attributes: resultAttributes,
                    fields: results.fields,
                    geometry: results.features[i].geometry
                });
                this.resultLength++;
            }
        },

        /**
        * Group address results according to type
        * @param {} candidates
        * @memberOf widgets/locator/locator
        */
        _showLocatedAddress: function (candidates) {
            var addrListCount = 0, addrList = [], candidateArray, divAddressContainer, candidate, addressListContainer, i, divAddressSearchCell;
            domConstruct.empty(this.divResultContainer);

            if (lang.trim(this.txtSearch.value) === "") {
                this.txtSearch.focus();
                this._toggleTexBoxControls(false);
                domConstruct.empty(this.divResultContainer);
                domClass.add(this.divResultContainer, "esriCTHidden");
                return;
            }


            // display all the located address in the address container
            // 'this.divResultContainer' div dom element contains located addresses, created in widget template
            // if results count is greater than 1, populate it in list else show no result message
            if (this.resultLength > 0) {
                this._toggleTexBoxControls(false);
                domClass.remove(this.divResultContainer, "esriCTHidden");
                for (candidateArray in candidates) {
                    if (candidates.hasOwnProperty(candidateArray)) {
                        if (candidates[candidateArray].length > 0) {
                            divAddressContainer = domConstruct.create("div", {
                                "class": "esriCTSearchGroupRow esriCTContentBottomBorder esriCTPointerCursor esriCTHeaderFont"
                            }, this.divResultContainer);
                            divAddressSearchCell = domConstruct.create("div", { "class": "esriCTSearchGroupCell" }, divAddressContainer);
                            candidate = candidateArray + " (" + candidates[candidateArray].length + ")";
                            domConstruct.create("span", { "innerHTML": "+", "class": "esriCTPlusMinus" }, divAddressSearchCell);
                            domConstruct.create("span", { "innerHTML": candidate, "class": "esriCTGroupList" }, divAddressSearchCell);
                            addrList.push(divAddressSearchCell);
                            this._toggleAddressList(addrList, addrListCount);
                            addrListCount++;
                            addressListContainer = domConstruct.create("div", { "class": "esriCTAddressListContainer esriCTHideAddressList" }, this.divResultContainer);

                            for (i = 0; i < candidates[candidateArray].length; i++) {
                                this._displayValidLocations(candidates[candidateArray][i], i, candidates[candidateArray], addressListContainer);
                            }
                        }
                    }
                }
            } else {
                this.mapPoint = null;
                this._locatorErrBack();
            }
        },

        /**
        * Display valid locations in address list
        * @param {} candidate
        * @param {} index
        * @param {} candidateArray
        * @param {} addressListContainer
        * @memberOf widgets/locator/locator
        */
        _displayValidLocations: function (candidate, index, candidateArray, addressListContainer) {
            var candidateAddress, divAddressRow;
            divAddressRow = domConstruct.create("div", { "class": "esriCTCandidateList" }, addressListContainer);
            candidateAddress = domConstruct.create("div", { "class": "esriCTCandidateField esriCTContentBottomBorder esriCTPointerCursor" }, divAddressRow);
            domAttr.set(candidateAddress, "index", index);
            try {
                if (candidate.name) {
                    domAttr.set(candidateAddress, "innerHTML", candidate.name);
                } else if (candidate.LatLong) {
                    domAttr.set(candidateAddress, "innerHTML", candidate.LatLong.coords);
                } else if (candidate.value) {
                    domAttr.set(candidateAddress, "innerHTML", candidate.value);
                }
                if (candidate.attributes && candidate.attributes.location) {
                    domAttr.set(candidateAddress, "x", candidate.attributes.location.x);
                    domAttr.set(candidateAddress, "y", candidate.attributes.location.y);
                }
            } catch (err) {
                dojo.applicationUtils.showError(err);
            }
            // handle click event when user clicks on a candidate address
            this.handleAddressClick(candidate, candidateAddress, candidateArray);
        },

        /**
        * Expand/ collapse the address list when user clicks on the address header
        * @param {} addressList
        * @param {} idx
        * @memberOf widgets/locator/locator
        */
        _toggleAddressList: function (addressList, idx) {
            on(addressList[idx], "click", lang.hitch(this, function (evt) {
                var addressListContainer, listStatusSymbol;
                addressListContainer = query(".esriCTAddressListContainer", this.divResultContainer)[idx];
                if (domClass.contains(addressListContainer, "esriCTShowAddressList")) {
                    domClass.toggle(addressListContainer, "esriCTShowAddressList");
                    listStatusSymbol = (domAttr.get(query(".esriCTPlusMinus", evt.currentTarget)[0], "innerHTML") === "+") ? "-" : "+";
                    domAttr.set(query(".esriCTPlusMinus", evt.currentTarget)[0], "innerHTML", listStatusSymbol);
                    return;
                }
                domClass.add(addressListContainer, "esriCTShowAddressList");
                domAttr.set(query(".esriCTPlusMinus", evt.currentTarget)[0], "innerHTML", "-");
            }));
        },

        /**
        * display error message if locator service fails or does not return any results
        * @memberOf widgets/locator/locator
        */
        _locatorErrBack: function () {
            domConstruct.empty(this.divResultContainer);
            domClass.remove(this.divResultContainer, "esriCTHidden");
            this._toggleTexBoxControls(false);
            domConstruct.create("div", { "class": "esriCTDivNoResultFound", "innerHTML": dojo.configData.i18n.locator.invalidSearch }, this.divResultContainer);
        },

        /**
        * Convert USNG to lat long
        * @memberOf widgets/locator/locator
        */
        _convertUSNG: function () {
            try {
                var value, converted = [];
                value = this.txtSearch.value;
                converted = [];
                // execute function available in usng.js file, which converts USNG and MGRS values to lat long value
                usng.USNGtoLL(value, converted);
                // if value is valid, store it in an object
                if (converted.length === 2) {
                    this.usngValue = {};
                    if (Number(converted[0]) && Number(converted[1])) {
                        this.usngValue = {
                            value: value,
                            coords: converted.join(",")
                        };
                    }
                }
                return;
            } catch (e) {
                return;
            }
        },

        /**
        * Convert MGRS to lat long
        * @memberOf widgets/locator/locator
        */
        _convertMGRS: function () {
            try {
                var value, converted = [];
                value = this.txtSearch.value;
                converted = [];
                // execute function available in usng.js file, which converts USNG and MGRS values to lat long value
                usng.USNGtoLL(value, converted);
                // if value is valid, store it in an object
                if (converted.length === 2) {
                    this.mgrsValue = {};
                    if (Number(converted[0]) && Number(converted[1])) {
                        this.mgrsValue = {
                            value: value,
                            coords: converted.join(",")
                        };
                    }
                }
                return;
            } catch (e) {
                return;
            }
        },

        /**
        * fetch latitude and longitude value from textbox and format it
        * @memberOf widgets/locator/locator
        */
        _getLatLongValue: function () {
            var splitValue, formattedValue;
            // split the lat long value with space
            splitValue = this.txtSearch.value.split(" ");
            // check if value received after splitting is of length 2 (latitude and longitude)
            if (splitValue.length === 2) {
                // loop through the results to substitute N,E,W,S with + and - accordingly
                array.forEach(splitValue, lang.hitch(this, function (value, index) {
                    formattedValue = value.replace("W", "-");
                    formattedValue = formattedValue.replace("S", "-");
                    formattedValue = formattedValue.replace("N", "");
                    formattedValue = formattedValue.replace("E", "");
                    splitValue[index] = formattedValue;
                }));
                // if value is valid, store it in an object
                if (splitValue[0] >= -90 && splitValue[0] <= 90 && splitValue[1] >= -180 && splitValue[1] <= 180) {
                    this.latLongValue = {
                        value: splitValue,
                        coords: this.txtSearch.value
                    };
                }
            }
        },

        /**
        * handle event when user clicks on search button of textbox
        * @param {} candidate
        * @param {} candidateAddress
        * @param {} candidateArray
        * @memberOf widgets/locator/locator
        */
        handleAddressClick: function (candidate, candidateAddress, candidateArray) {
            on(candidateAddress, "click", lang.hitch(this, function (evt) {
                var candidateSplitValue, mapPoint;
                domAttr.set(this.txtSearch, "defaultAddress", evt.currentTarget.innerHTML);
                this.txtSearch.value = domAttr.get(this.txtSearch, "defaultAddress");
                // selected candidate is address
                if (candidate.attributes && candidate.attributes.location) {
                    mapPoint = new Point(domAttr.get(evt.currentTarget, "x"), domAttr.get(evt.currentTarget, "y"), this.map.spatialReference);
                    this.candidateGeometry = mapPoint;
                    // selected candidate is latitude and longitude value
                } else if (candidate.name) {
                    if (candidate.geometry) {
                        this.candidateGeometry = candidate.geometry;
                    }
                } else if (candidate.LatLong) {
                    this._projectOnMap(candidate.LatLong.value[0], candidate.LatLong.value[1]);
                    // selected candidate is USNG or MGRS
                } else if (candidate.value) {
                    candidateSplitValue = candidate.coords.split(",");
                    this._projectOnMap(candidateSplitValue[0], candidateSplitValue[1]);
                }
                this.onLocationCompleted(this.candidateGeometry);
            }));
        },

        /**
        * Validate x and y coordinate values, if valid project it on map
        * @param {} x
        * @param {} y
        * @memberOf widgets/locator/locator
        */
        _projectOnMap: function (x, y) {
            if (x >= -90 && x <= 90 && y >= -180 && y <= 180) {
                var mapLocation = new Point(y, x);
                // convert point
                this._projectPoint(mapLocation).then(lang.hitch(this, function (pt) {
                    if (pt) {
                        this.candidateGeometry = pt;
                    }
                }), function (error) {
                    dojo.applicationUtils.showError(error.message);
                });
            }
        },

        /**
        * Return the selected address's geometry
        * @param {} geometry
        * @memberOf widgets/locator/locator
        */
        onLocationCompleted: function (geometry) {
            return geometry;
        },

        /**
        * plot x,y point on map in mercator
        * @param {} x
        * @param {} y
        * @memberOf widgets/locator/locator
        */
        _projectPoint: function (geometry) {
            var def, sr, pt, params;
            // this function takes a lat/long (4326) point and converts it to map's spatial reference.
            def = new Deferred();
            // maps spatial ref
            sr = this.map.spatialReference;
            // map and point are both lat/long
            if (sr.wkid === 4326) {
                def.resolve(geometry);
                // map is mercator
            } else if (sr.isWebMercator()) {
                // convert lat long to mercator. No network request.
                pt = webMercatorUtils.geographicToWebMercator(geometry);
                def.resolve(pt);
                // map is something else & has geometry service
            } else if (esriConfig.defaults.geometryService) {
                // project params
                params = new ProjectParameters();
                params.geometries = [geometry];
                params.outSR = this.map.spatialReference;
                // use geometry service to convert lat long to map format (network request)
                esriConfig.defaults.geometryService.project(params).then(function (projectedPoints) {
                    if (projectedPoints && projectedPoints.length) {
                        def.resolve(projectedPoints[0]);
                    } else {
                        def.reject();
                    }
                }, function (error) {
                    def.reject(error);
                });
            } else {// cant do anything, leave lat/long
                def.resolve(geometry);
            }
            return def;
        },

        /**
        * Show/hide close and search loader image
        * @param {} isShow
        * @memberOf widgets/locator/locator
        */
        _toggleTexBoxControls: function (isShow) {
            if (isShow) {
                domStyle.set(this.imgSearchLoader, "display", "block");
                domStyle.set(this.close, "display", "none");
            } else {
                domStyle.set(this.imgSearchLoader, "display", "none");
                domStyle.set(this.close, "display", "block");
            }
        },

        /**
        * Hide text present in textbox, also hide search results container
        * @memberOf widgets/locator/locator
        */
        _hideText: function () {
            this.txtSearch.value = "";
            this.lastSearchString = lang.trim(this.txtSearch.value);
            domConstruct.empty(this.divResultContainer);
            domClass.add(this.divResultContainer, "esriCTHidden");
            domAttr.set(this.txtSearch, "defaultAddress", this.txtSearch.value);
        }

    });
});

