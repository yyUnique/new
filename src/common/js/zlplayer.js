(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.adapter = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
    /*
     *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
     *
     *  Use of this source code is governed by a BSD-style license
     *  that can be found in the LICENSE file in the root of the source
     *  tree.
     */
     /* eslint-env node */
    'use strict';
    
    var SDPUtils = require('sdp');
    
    function fixStatsType(stat) {
      return {
        inboundrtp: 'inbound-rtp',
        outboundrtp: 'outbound-rtp',
        candidatepair: 'candidate-pair',
        localcandidate: 'local-candidate',
        remotecandidate: 'remote-candidate'
      }[stat.type] || stat.type;
    }
    
    function writeMediaSection(transceiver, caps, type, stream, dtlsRole) {
      var sdp = SDPUtils.writeRtpDescription(transceiver.kind, caps);
    
      // Map ICE parameters (ufrag, pwd) to SDP.
      sdp += SDPUtils.writeIceParameters(
          transceiver.iceGatherer.getLocalParameters());
    
      // Map DTLS parameters to SDP.
      sdp += SDPUtils.writeDtlsParameters(
          transceiver.dtlsTransport.getLocalParameters(),
          type === 'offer' ? 'actpass' : dtlsRole || 'active');
    
      sdp += 'a=mid:' + transceiver.mid + '\r\n';
    
      if (transceiver.rtpSender && transceiver.rtpReceiver) {
        sdp += 'a=sendrecv\r\n';
      } else if (transceiver.rtpSender) {
        sdp += 'a=sendonly\r\n';
      } else if (transceiver.rtpReceiver) {
        sdp += 'a=recvonly\r\n';
      } else {
        sdp += 'a=inactive\r\n';
      }
    
      if (transceiver.rtpSender) {
        var trackId = transceiver.rtpSender._initialTrackId ||
            transceiver.rtpSender.track.id;
        transceiver.rtpSender._initialTrackId = trackId;
        // spec.
        var msid = 'msid:' + (stream ? stream.id : '-') + ' ' +
            trackId + '\r\n';
        sdp += 'a=' + msid;
        // for Chrome. Legacy should no longer be required.
        sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
            ' ' + msid;
    
        // RTX
        if (transceiver.sendEncodingParameters[0].rtx) {
          sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
              ' ' + msid;
          sdp += 'a=ssrc-group:FID ' +
              transceiver.sendEncodingParameters[0].ssrc + ' ' +
              transceiver.sendEncodingParameters[0].rtx.ssrc +
              '\r\n';
        }
      }
      // FIXME: this should be written by writeRtpDescription.
      sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
          ' cname:' + SDPUtils.localCName + '\r\n';
      if (transceiver.rtpSender && transceiver.sendEncodingParameters[0].rtx) {
        sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
            ' cname:' + SDPUtils.localCName + '\r\n';
      }
      return sdp;
    }
    
    // Edge does not like
    // 1) stun: filtered after 14393 unless ?transport=udp is present
    // 2) turn: that does not have all of turn:host:port?transport=udp
    // 3) turn: with ipv6 addresses
    // 4) turn: occurring muliple times
    function filterIceServers(iceServers, edgeVersion) {
      var hasTurn = false;
      iceServers = JSON.parse(JSON.stringify(iceServers));
      return iceServers.filter(function(server) {
        if (server && (server.urls || server.url)) {
          var urls = server.urls || server.url;
          if (server.url && !server.urls) {
            console.warn('RTCIceServer.url is deprecated! Use urls instead.');
          }
          var isString = typeof urls === 'string';
          if (isString) {
            urls = [urls];
          }
          urls = urls.filter(function(url) {
            var validTurn = url.indexOf('turn:') === 0 &&
                url.indexOf('transport=udp') !== -1 &&
                url.indexOf('turn:[') === -1 &&
                !hasTurn;
    
            if (validTurn) {
              hasTurn = true;
              return true;
            }
            return url.indexOf('stun:') === 0 && edgeVersion >= 14393 &&
                url.indexOf('?transport=udp') === -1;
          });
    
          delete server.url;
          server.urls = isString ? urls[0] : urls;
          return !!urls.length;
        }
      });
    }
    
    // Determines the intersection of local and remote capabilities.
    function getCommonCapabilities(localCapabilities, remoteCapabilities) {
      var commonCapabilities = {
        codecs: [],
        headerExtensions: [],
        fecMechanisms: []
      };
    
      var findCodecByPayloadType = function(pt, codecs) {
        pt = parseInt(pt, 10);
        for (var i = 0; i < codecs.length; i++) {
          if (codecs[i].payloadType === pt ||
              codecs[i].preferredPayloadType === pt) {
            return codecs[i];
          }
        }
      };
    
      var rtxCapabilityMatches = function(lRtx, rRtx, lCodecs, rCodecs) {
        var lCodec = findCodecByPayloadType(lRtx.parameters.apt, lCodecs);
        var rCodec = findCodecByPayloadType(rRtx.parameters.apt, rCodecs);
        return lCodec && rCodec &&
            lCodec.name.toLowerCase() === rCodec.name.toLowerCase();
      };
    
      localCapabilities.codecs.forEach(function(lCodec) {
        for (var i = 0; i < remoteCapabilities.codecs.length; i++) {
          var rCodec = remoteCapabilities.codecs[i];
          if (lCodec.name.toLowerCase() === rCodec.name.toLowerCase() &&
              lCodec.clockRate === rCodec.clockRate) {
            if (lCodec.name.toLowerCase() === 'rtx' &&
                lCodec.parameters && rCodec.parameters.apt) {
              // for RTX we need to find the local rtx that has a apt
              // which points to the same local codec as the remote one.
              if (!rtxCapabilityMatches(lCodec, rCodec,
                  localCapabilities.codecs, remoteCapabilities.codecs)) {
                continue;
              }
            }
            rCodec = JSON.parse(JSON.stringify(rCodec)); // deepcopy
            // number of channels is the highest common number of channels
            rCodec.numChannels = Math.min(lCodec.numChannels,
                rCodec.numChannels);
            // push rCodec so we reply with offerer payload type
            commonCapabilities.codecs.push(rCodec);
    
            // determine common feedback mechanisms
            rCodec.rtcpFeedback = rCodec.rtcpFeedback.filter(function(fb) {
              for (var j = 0; j < lCodec.rtcpFeedback.length; j++) {
                if (lCodec.rtcpFeedback[j].type === fb.type &&
                    lCodec.rtcpFeedback[j].parameter === fb.parameter) {
                  return true;
                }
              }
              return false;
            });
            // FIXME: also need to determine .parameters
            //  see https://github.com/openpeer/ortc/issues/569
            break;
          }
        }
      });
    
      localCapabilities.headerExtensions.forEach(function(lHeaderExtension) {
        for (var i = 0; i < remoteCapabilities.headerExtensions.length;
             i++) {
          var rHeaderExtension = remoteCapabilities.headerExtensions[i];
          if (lHeaderExtension.uri === rHeaderExtension.uri) {
            commonCapabilities.headerExtensions.push(rHeaderExtension);
            break;
          }
        }
      });
    
      // FIXME: fecMechanisms
      return commonCapabilities;
    }
    
    // is action=setLocalDescription with type allowed in signalingState
    function isActionAllowedInSignalingState(action, type, signalingState) {
      return {
        offer: {
          setLocalDescription: ['stable', 'have-local-offer'],
          setRemoteDescription: ['stable', 'have-remote-offer']
        },
        answer: {
          setLocalDescription: ['have-remote-offer', 'have-local-pranswer'],
          setRemoteDescription: ['have-local-offer', 'have-remote-pranswer']
        }
      }[type][action].indexOf(signalingState) !== -1;
    }
    
    function maybeAddCandidate(iceTransport, candidate) {
      // Edge's internal representation adds some fields therefore
      // not all fieldѕ are taken into account.
      var alreadyAdded = iceTransport.getRemoteCandidates()
          .find(function(remoteCandidate) {
            return candidate.foundation === remoteCandidate.foundation &&
                candidate.ip === remoteCandidate.ip &&
                candidate.port === remoteCandidate.port &&
                candidate.priority === remoteCandidate.priority &&
                candidate.protocol === remoteCandidate.protocol &&
                candidate.type === remoteCandidate.type;
          });
      if (!alreadyAdded) {
        iceTransport.addRemoteCandidate(candidate);
      }
      return !alreadyAdded;
    }
    
    
    function makeError(name, description) {
      var e = new Error(description);
      e.name = name;
      // legacy error codes from https://heycam.github.io/webidl/#idl-DOMException-error-names
      e.code = {
        NotSupportedError: 9,
        InvalidStateError: 11,
        InvalidAccessError: 15,
        TypeError: undefined,
        OperationError: undefined
      }[name];
      return e;
    }
    
    module.exports = function(window, edgeVersion) {
      // https://w3c.github.io/mediacapture-main/#mediastream
      // Helper function to add the track to the stream and
      // dispatch the event ourselves.
      function addTrackToStreamAndFireEvent(track, stream) {
        stream.addTrack(track);
        stream.dispatchEvent(new window.MediaStreamTrackEvent('addtrack',
            {track: track}));
      }
    
      function removeTrackFromStreamAndFireEvent(track, stream) {
        stream.removeTrack(track);
        stream.dispatchEvent(new window.MediaStreamTrackEvent('removetrack',
            {track: track}));
      }
    
      function fireAddTrack(pc, track, receiver, streams) {
        var trackEvent = new Event('track');
        trackEvent.track = track;
        trackEvent.receiver = receiver;
        trackEvent.transceiver = {receiver: receiver};
        trackEvent.streams = streams;
        window.setTimeout(function() {
          pc._dispatchEvent('track', trackEvent);
        });
      }
    
      var RTCPeerConnection = function(config) {
        var pc = this;
    
        var _eventTarget = document.createDocumentFragment();
        ['addEventListener', 'removeEventListener', 'dispatchEvent']
            .forEach(function(method) {
              pc[method] = _eventTarget[method].bind(_eventTarget);
            });
    
        this.canTrickleIceCandidates = null;
    
        this.needNegotiation = false;
    
        this.localStreams = [];
        this.remoteStreams = [];
    
        this._localDescription = null;
        this._remoteDescription = null;
    
        this.signalingState = 'stable';
        this.iceConnectionState = 'new';
        this.connectionState = 'new';
        this.iceGatheringState = 'new';
    
        config = JSON.parse(JSON.stringify(config || {}));
    
        this.usingBundle = config.bundlePolicy === 'max-bundle';
        if (config.rtcpMuxPolicy === 'negotiate') {
          throw(makeError('NotSupportedError',
              'rtcpMuxPolicy \'negotiate\' is not supported'));
        } else if (!config.rtcpMuxPolicy) {
          config.rtcpMuxPolicy = 'require';
        }
    
        switch (config.iceTransportPolicy) {
          case 'all':
          case 'relay':
            break;
          default:
            config.iceTransportPolicy = 'all';
            break;
        }
    
        switch (config.bundlePolicy) {
          case 'balanced':
          case 'max-compat':
          case 'max-bundle':
            break;
          default:
            config.bundlePolicy = 'balanced';
            break;
        }
    
        config.iceServers = filterIceServers(config.iceServers || [], edgeVersion);
    
        this._iceGatherers = [];
        if (config.iceCandidatePoolSize) {
          for (var i = config.iceCandidatePoolSize; i > 0; i--) {
            this._iceGatherers.push(new window.RTCIceGatherer({
              iceServers: config.iceServers,
              gatherPolicy: config.iceTransportPolicy
            }));
          }
        } else {
          config.iceCandidatePoolSize = 0;
        }
    
        this._config = config;
    
        // per-track iceGathers, iceTransports, dtlsTransports, rtpSenders, ...
        // everything that is needed to describe a SDP m-line.
        this.transceivers = [];
    
        this._sdpSessionId = SDPUtils.generateSessionId();
        this._sdpSessionVersion = 0;
    
        this._dtlsRole = undefined; // role for a=setup to use in answers.
    
        this._isClosed = false;
      };
    
      Object.defineProperty(RTCPeerConnection.prototype, 'localDescription', {
        configurable: true,
        get: function() {
          return this._localDescription;
        }
      });
      Object.defineProperty(RTCPeerConnection.prototype, 'remoteDescription', {
        configurable: true,
        get: function() {
          return this._remoteDescription;
        }
      });
    
      // set up event handlers on prototype
      RTCPeerConnection.prototype.onicecandidate = null;
      RTCPeerConnection.prototype.onaddstream = null;
      RTCPeerConnection.prototype.ontrack = null;
      RTCPeerConnection.prototype.onremovestream = null;
      RTCPeerConnection.prototype.onsignalingstatechange = null;
      RTCPeerConnection.prototype.oniceconnectionstatechange = null;
      RTCPeerConnection.prototype.onconnectionstatechange = null;
      RTCPeerConnection.prototype.onicegatheringstatechange = null;
      RTCPeerConnection.prototype.onnegotiationneeded = null;
      RTCPeerConnection.prototype.ondatachannel = null;
    
      RTCPeerConnection.prototype._dispatchEvent = function(name, event) {
        if (this._isClosed) {
          return;
        }
        this.dispatchEvent(event);
        if (typeof this['on' + name] === 'function') {
          this['on' + name](event);
        }
      };
    
      RTCPeerConnection.prototype._emitGatheringStateChange = function() {
        var event = new Event('icegatheringstatechange');
        this._dispatchEvent('icegatheringstatechange', event);
      };
    
      RTCPeerConnection.prototype.getConfiguration = function() {
        return this._config;
      };
    
      RTCPeerConnection.prototype.getLocalStreams = function() {
        return this.localStreams;
      };
    
      RTCPeerConnection.prototype.getRemoteStreams = function() {
        return this.remoteStreams;
      };
    
      // internal helper to create a transceiver object.
      // (which is not yet the same as the WebRTC 1.0 transceiver)
      RTCPeerConnection.prototype._createTransceiver = function(kind, doNotAdd) {
        var hasBundleTransport = this.transceivers.length > 0;
        var transceiver = {
          track: null,
          iceGatherer: null,
          iceTransport: null,
          dtlsTransport: null,
          localCapabilities: null,
          remoteCapabilities: null,
          rtpSender: null,
          rtpReceiver: null,
          kind: kind,
          mid: null,
          sendEncodingParameters: null,
          recvEncodingParameters: null,
          stream: null,
          associatedRemoteMediaStreams: [],
          wantReceive: true
        };
        if (this.usingBundle && hasBundleTransport) {
          transceiver.iceTransport = this.transceivers[0].iceTransport;
          transceiver.dtlsTransport = this.transceivers[0].dtlsTransport;
        } else {
          var transports = this._createIceAndDtlsTransports();
          transceiver.iceTransport = transports.iceTransport;
          transceiver.dtlsTransport = transports.dtlsTransport;
        }
        if (!doNotAdd) {
          this.transceivers.push(transceiver);
        }
        return transceiver;
      };
    
      RTCPeerConnection.prototype.addTrack = function(track, stream) {
        if (this._isClosed) {
          throw makeError('InvalidStateError',
              'Attempted to call addTrack on a closed peerconnection.');
        }
    
        var alreadyExists = this.transceivers.find(function(s) {
          return s.track === track;
        });
    
        if (alreadyExists) {
          throw makeError('InvalidAccessError', 'Track already exists.');
        }
    
        var transceiver;
        for (var i = 0; i < this.transceivers.length; i++) {
          if (!this.transceivers[i].track &&
              this.transceivers[i].kind === track.kind) {
            transceiver = this.transceivers[i];
          }
        }
        if (!transceiver) {
          transceiver = this._createTransceiver(track.kind);
        }
    
        this._maybeFireNegotiationNeeded();
    
        if (this.localStreams.indexOf(stream) === -1) {
          this.localStreams.push(stream);
        }
    
        transceiver.track = track;
        transceiver.stream = stream;
        transceiver.rtpSender = new window.RTCRtpSender(track,
            transceiver.dtlsTransport);
        return transceiver.rtpSender;
      };
    
      RTCPeerConnection.prototype.addStream = function(stream) {
        var pc = this;
        if (edgeVersion >= 15025) {
          stream.getTracks().forEach(function(track) {
            pc.addTrack(track, stream);
          });
        } else {
          // Clone is necessary for local demos mostly, attaching directly
          // to two different senders does not work (build 10547).
          // Fixed in 15025 (or earlier)
          var clonedStream = stream.clone();
          stream.getTracks().forEach(function(track, idx) {
            var clonedTrack = clonedStream.getTracks()[idx];
            track.addEventListener('enabled', function(event) {
              clonedTrack.enabled = event.enabled;
            });
          });
          clonedStream.getTracks().forEach(function(track) {
            pc.addTrack(track, clonedStream);
          });
        }
      };
    
      RTCPeerConnection.prototype.removeTrack = function(sender) {
        if (this._isClosed) {
          throw makeError('InvalidStateError',
              'Attempted to call removeTrack on a closed peerconnection.');
        }
    
        if (!(sender instanceof window.RTCRtpSender)) {
          throw new TypeError('Argument 1 of RTCPeerConnection.removeTrack ' +
              'does not implement interface RTCRtpSender.');
        }
    
        var transceiver = this.transceivers.find(function(t) {
          return t.rtpSender === sender;
        });
    
        if (!transceiver) {
          throw makeError('InvalidAccessError',
              'Sender was not created by this connection.');
        }
        var stream = transceiver.stream;
    
        transceiver.rtpSender.stop();
        transceiver.rtpSender = null;
        transceiver.track = null;
        transceiver.stream = null;
    
        // remove the stream from the set of local streams
        var localStreams = this.transceivers.map(function(t) {
          return t.stream;
        });
        if (localStreams.indexOf(stream) === -1 &&
            this.localStreams.indexOf(stream) > -1) {
          this.localStreams.splice(this.localStreams.indexOf(stream), 1);
        }
    
        this._maybeFireNegotiationNeeded();
      };
    
      RTCPeerConnection.prototype.removeStream = function(stream) {
        var pc = this;
        stream.getTracks().forEach(function(track) {
          var sender = pc.getSenders().find(function(s) {
            return s.track === track;
          });
          if (sender) {
            pc.removeTrack(sender);
          }
        });
      };
    
      RTCPeerConnection.prototype.getSenders = function() {
        return this.transceivers.filter(function(transceiver) {
          return !!transceiver.rtpSender;
        })
        .map(function(transceiver) {
          return transceiver.rtpSender;
        });
      };
    
      RTCPeerConnection.prototype.getReceivers = function() {
        return this.transceivers.filter(function(transceiver) {
          return !!transceiver.rtpReceiver;
        })
        .map(function(transceiver) {
          return transceiver.rtpReceiver;
        });
      };
    
    
      RTCPeerConnection.prototype._createIceGatherer = function(sdpMLineIndex,
          usingBundle) {
        var pc = this;
        if (usingBundle && sdpMLineIndex > 0) {
          return this.transceivers[0].iceGatherer;
        } else if (this._iceGatherers.length) {
          return this._iceGatherers.shift();
        }
        var iceGatherer = new window.RTCIceGatherer({
          iceServers: this._config.iceServers,
          gatherPolicy: this._config.iceTransportPolicy
        });
        Object.defineProperty(iceGatherer, 'state',
            {value: 'new', writable: true}
        );
    
        this.transceivers[sdpMLineIndex].bufferedCandidateEvents = [];
        this.transceivers[sdpMLineIndex].bufferCandidates = function(event) {
          var end = !event.candidate || Object.keys(event.candidate).length === 0;
          // polyfill since RTCIceGatherer.state is not implemented in
          // Edge 10547 yet.
          iceGatherer.state = end ? 'completed' : 'gathering';
          if (pc.transceivers[sdpMLineIndex].bufferedCandidateEvents !== null) {
            pc.transceivers[sdpMLineIndex].bufferedCandidateEvents.push(event);
          }
        };
        iceGatherer.addEventListener('localcandidate',
          this.transceivers[sdpMLineIndex].bufferCandidates);
        return iceGatherer;
      };
    
      // start gathering from an RTCIceGatherer.
      RTCPeerConnection.prototype._gather = function(mid, sdpMLineIndex) {
        var pc = this;
        var iceGatherer = this.transceivers[sdpMLineIndex].iceGatherer;
        if (iceGatherer.onlocalcandidate) {
          return;
        }
        var bufferedCandidateEvents =
          this.transceivers[sdpMLineIndex].bufferedCandidateEvents;
        this.transceivers[sdpMLineIndex].bufferedCandidateEvents = null;
        iceGatherer.removeEventListener('localcandidate',
          this.transceivers[sdpMLineIndex].bufferCandidates);
        iceGatherer.onlocalcandidate = function(evt) {
          if (pc.usingBundle && sdpMLineIndex > 0) {
            // if we know that we use bundle we can drop candidates with
            // ѕdpMLineIndex > 0. If we don't do this then our state gets
            // confused since we dispose the extra ice gatherer.
            return;
          }
          var event = new Event('icecandidate');
          event.candidate = {sdpMid: mid, sdpMLineIndex: sdpMLineIndex};
    
          var cand = evt.candidate;
          // Edge emits an empty object for RTCIceCandidateComplete‥
          var end = !cand || Object.keys(cand).length === 0;
          if (end) {
            // polyfill since RTCIceGatherer.state is not implemented in
            // Edge 10547 yet.
            if (iceGatherer.state === 'new' || iceGatherer.state === 'gathering') {
              iceGatherer.state = 'completed';
            }
          } else {
            if (iceGatherer.state === 'new') {
              iceGatherer.state = 'gathering';
            }
            // RTCIceCandidate doesn't have a component, needs to be added
            cand.component = 1;
            // also the usernameFragment. TODO: update SDP to take both variants.
            cand.ufrag = iceGatherer.getLocalParameters().usernameFragment;
    
            var serializedCandidate = SDPUtils.writeCandidate(cand);
            event.candidate = Object.assign(event.candidate,
                SDPUtils.parseCandidate(serializedCandidate));
    
            event.candidate.candidate = serializedCandidate;
            event.candidate.toJSON = function() {
              return {
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
                usernameFragment: event.candidate.usernameFragment
              };
            };
          }
    
          // update local description.
          var sections = SDPUtils.getMediaSections(pc._localDescription.sdp);
          if (!end) {
            sections[event.candidate.sdpMLineIndex] +=
                'a=' + event.candidate.candidate + '\r\n';
          } else {
            sections[event.candidate.sdpMLineIndex] +=
                'a=end-of-candidates\r\n';
          }
          pc._localDescription.sdp =
              SDPUtils.getDescription(pc._localDescription.sdp) +
              sections.join('');
          var complete = pc.transceivers.every(function(transceiver) {
            return transceiver.iceGatherer &&
                transceiver.iceGatherer.state === 'completed';
          });
    
          if (pc.iceGatheringState !== 'gathering') {
            pc.iceGatheringState = 'gathering';
            pc._emitGatheringStateChange();
          }
    
          // Emit candidate. Also emit null candidate when all gatherers are
          // complete.
          if (!end) {
            pc._dispatchEvent('icecandidate', event);
          }
          if (complete) {
            pc._dispatchEvent('icecandidate', new Event('icecandidate'));
            pc.iceGatheringState = 'complete';
            pc._emitGatheringStateChange();
          }
        };
    
        // emit already gathered candidates.
        window.setTimeout(function() {
          bufferedCandidateEvents.forEach(function(e) {
            iceGatherer.onlocalcandidate(e);
          });
        }, 0);
      };
    
      // Create ICE transport and DTLS transport.
      RTCPeerConnection.prototype._createIceAndDtlsTransports = function() {
        var pc = this;
        var iceTransport = new window.RTCIceTransport(null);
        iceTransport.onicestatechange = function() {
          pc._updateIceConnectionState();
          pc._updateConnectionState();
        };
    
        var dtlsTransport = new window.RTCDtlsTransport(iceTransport);
        dtlsTransport.ondtlsstatechange = function() {
          pc._updateConnectionState();
        };
        dtlsTransport.onerror = function() {
          // onerror does not set state to failed by itself.
          Object.defineProperty(dtlsTransport, 'state',
              {value: 'failed', writable: true});
          pc._updateConnectionState();
        };
    
        return {
          iceTransport: iceTransport,
          dtlsTransport: dtlsTransport
        };
      };
    
      // Destroy ICE gatherer, ICE transport and DTLS transport.
      // Without triggering the callbacks.
      RTCPeerConnection.prototype._disposeIceAndDtlsTransports = function(
          sdpMLineIndex) {
        var iceGatherer = this.transceivers[sdpMLineIndex].iceGatherer;
        if (iceGatherer) {
          delete iceGatherer.onlocalcandidate;
          delete this.transceivers[sdpMLineIndex].iceGatherer;
        }
        var iceTransport = this.transceivers[sdpMLineIndex].iceTransport;
        if (iceTransport) {
          delete iceTransport.onicestatechange;
          delete this.transceivers[sdpMLineIndex].iceTransport;
        }
        var dtlsTransport = this.transceivers[sdpMLineIndex].dtlsTransport;
        if (dtlsTransport) {
          delete dtlsTransport.ondtlsstatechange;
          delete dtlsTransport.onerror;
          delete this.transceivers[sdpMLineIndex].dtlsTransport;
        }
      };
    
      // Start the RTP Sender and Receiver for a transceiver.
      RTCPeerConnection.prototype._transceive = function(transceiver,
          send, recv) {
        var params = getCommonCapabilities(transceiver.localCapabilities,
            transceiver.remoteCapabilities);
        if (send && transceiver.rtpSender) {
          params.encodings = transceiver.sendEncodingParameters;
          params.rtcp = {
            cname: SDPUtils.localCName,
            compound: transceiver.rtcpParameters.compound
          };
          if (transceiver.recvEncodingParameters.length) {
            params.rtcp.ssrc = transceiver.recvEncodingParameters[0].ssrc;
          }
          transceiver.rtpSender.send(params);
        }
        if (recv && transceiver.rtpReceiver && params.codecs.length > 0) {
          // remove RTX field in Edge 14942
          if (transceiver.kind === 'video'
              && transceiver.recvEncodingParameters
              && edgeVersion < 15019) {
            transceiver.recvEncodingParameters.forEach(function(p) {
              delete p.rtx;
            });
          }
          if (transceiver.recvEncodingParameters.length) {
            params.encodings = transceiver.recvEncodingParameters;
          } else {
            params.encodings = [{}];
          }
          params.rtcp = {
            compound: transceiver.rtcpParameters.compound
          };
          if (transceiver.rtcpParameters.cname) {
            params.rtcp.cname = transceiver.rtcpParameters.cname;
          }
          if (transceiver.sendEncodingParameters.length) {
            params.rtcp.ssrc = transceiver.sendEncodingParameters[0].ssrc;
          }
          transceiver.rtpReceiver.receive(params);
        }
      };
    
      RTCPeerConnection.prototype.setLocalDescription = function(description) {
        var pc = this;
    
        // Note: pranswer is not supported.
        if (['offer', 'answer'].indexOf(description.type) === -1) {
          return Promise.reject(makeError('TypeError',
              'Unsupported type "' + description.type + '"'));
        }
    
        if (!isActionAllowedInSignalingState('setLocalDescription',
            description.type, pc.signalingState) || pc._isClosed) {
          return Promise.reject(makeError('InvalidStateError',
              'Can not set local ' + description.type +
              ' in state ' + pc.signalingState));
        }
    
        var sections;
        var sessionpart;
        if (description.type === 'offer') {
          // VERY limited support for SDP munging. Limited to:
          // * changing the order of codecs
          sections = SDPUtils.splitSections(description.sdp);
          sessionpart = sections.shift();
          sections.forEach(function(mediaSection, sdpMLineIndex) {
            var caps = SDPUtils.parseRtpParameters(mediaSection);
            pc.transceivers[sdpMLineIndex].localCapabilities = caps;
          });
    
          pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
            pc._gather(transceiver.mid, sdpMLineIndex);
          });
        } else if (description.type === 'answer') {
          sections = SDPUtils.splitSections(pc._remoteDescription.sdp);
          sessionpart = sections.shift();
          var isIceLite = SDPUtils.matchPrefix(sessionpart,
              'a=ice-lite').length > 0;
          sections.forEach(function(mediaSection, sdpMLineIndex) {
            var transceiver = pc.transceivers[sdpMLineIndex];
            var iceGatherer = transceiver.iceGatherer;
            var iceTransport = transceiver.iceTransport;
            var dtlsTransport = transceiver.dtlsTransport;
            var localCapabilities = transceiver.localCapabilities;
            var remoteCapabilities = transceiver.remoteCapabilities;
    
            // treat bundle-only as not-rejected.
            var rejected = SDPUtils.isRejected(mediaSection) &&
                SDPUtils.matchPrefix(mediaSection, 'a=bundle-only').length === 0;
    
            if (!rejected && !transceiver.rejected) {
              var remoteIceParameters = SDPUtils.getIceParameters(
                  mediaSection, sessionpart);
              var remoteDtlsParameters = SDPUtils.getDtlsParameters(
                  mediaSection, sessionpart);
              if (isIceLite) {
                remoteDtlsParameters.role = 'server';
              }
    
              if (!pc.usingBundle || sdpMLineIndex === 0) {
                pc._gather(transceiver.mid, sdpMLineIndex);
                if (iceTransport.state === 'new') {
                  iceTransport.start(iceGatherer, remoteIceParameters,
                      isIceLite ? 'controlling' : 'controlled');
                }
                if (dtlsTransport.state === 'new') {
                  dtlsTransport.start(remoteDtlsParameters);
                }
              }
    
              // Calculate intersection of capabilities.
              var params = getCommonCapabilities(localCapabilities,
                  remoteCapabilities);
    
              // Start the RTCRtpSender. The RTCRtpReceiver for this
              // transceiver has already been started in setRemoteDescription.
              pc._transceive(transceiver,
                  params.codecs.length > 0,
                  false);
            }
          });
        }
    
        pc._localDescription = {
          type: description.type,
          sdp: description.sdp
        };
        if (description.type === 'offer') {
          pc._updateSignalingState('have-local-offer');
        } else {
          pc._updateSignalingState('stable');
        }
    
        return Promise.resolve();
      };
    
      RTCPeerConnection.prototype.setRemoteDescription = function(description) {
        var pc = this;
    
        // Note: pranswer is not supported.
        if (['offer', 'answer'].indexOf(description.type) === -1) {
          return Promise.reject(makeError('TypeError',
              'Unsupported type "' + description.type + '"'));
        }
    
        if (!isActionAllowedInSignalingState('setRemoteDescription',
            description.type, pc.signalingState) || pc._isClosed) {
          return Promise.reject(makeError('InvalidStateError',
              'Can not set remote ' + description.type +
              ' in state ' + pc.signalingState));
        }
    
        var streams = {};
        pc.remoteStreams.forEach(function(stream) {
          streams[stream.id] = stream;
        });
        var receiverList = [];
        var sections = SDPUtils.splitSections(description.sdp);
        var sessionpart = sections.shift();
        var isIceLite = SDPUtils.matchPrefix(sessionpart,
            'a=ice-lite').length > 0;
        var usingBundle = SDPUtils.matchPrefix(sessionpart,
            'a=group:BUNDLE ').length > 0;
        pc.usingBundle = usingBundle;
        var iceOptions = SDPUtils.matchPrefix(sessionpart,
            'a=ice-options:')[0];
        if (iceOptions) {
          pc.canTrickleIceCandidates = iceOptions.substr(14).split(' ')
              .indexOf('trickle') >= 0;
        } else {
          pc.canTrickleIceCandidates = false;
        }
    
        sections.forEach(function(mediaSection, sdpMLineIndex) {
          var lines = SDPUtils.splitLines(mediaSection);
          var kind = SDPUtils.getKind(mediaSection);
          // treat bundle-only as not-rejected.
          var rejected = SDPUtils.isRejected(mediaSection) &&
              SDPUtils.matchPrefix(mediaSection, 'a=bundle-only').length === 0;
          var protocol = lines[0].substr(2).split(' ')[2];
    
          var direction = SDPUtils.getDirection(mediaSection, sessionpart);
          var remoteMsid = SDPUtils.parseMsid(mediaSection);
    
          var mid = SDPUtils.getMid(mediaSection) || SDPUtils.generateIdentifier();
    
          // Reject datachannels which are not implemented yet.
          if (rejected || (kind === 'application' && (protocol === 'DTLS/SCTP' ||
              protocol === 'UDP/DTLS/SCTP'))) {
            // TODO: this is dangerous in the case where a non-rejected m-line
            //     becomes rejected.
            pc.transceivers[sdpMLineIndex] = {
              mid: mid,
              kind: kind,
              protocol: protocol,
              rejected: true
            };
            return;
          }
    
          if (!rejected && pc.transceivers[sdpMLineIndex] &&
              pc.transceivers[sdpMLineIndex].rejected) {
            // recycle a rejected transceiver.
            pc.transceivers[sdpMLineIndex] = pc._createTransceiver(kind, true);
          }
    
          var transceiver;
          var iceGatherer;
          var iceTransport;
          var dtlsTransport;
          var rtpReceiver;
          var sendEncodingParameters;
          var recvEncodingParameters;
          var localCapabilities;
    
          var track;
          // FIXME: ensure the mediaSection has rtcp-mux set.
          var remoteCapabilities = SDPUtils.parseRtpParameters(mediaSection);
          var remoteIceParameters;
          var remoteDtlsParameters;
          if (!rejected) {
            remoteIceParameters = SDPUtils.getIceParameters(mediaSection,
                sessionpart);
            remoteDtlsParameters = SDPUtils.getDtlsParameters(mediaSection,
                sessionpart);
            remoteDtlsParameters.role = 'client';
          }
          recvEncodingParameters =
              SDPUtils.parseRtpEncodingParameters(mediaSection);
    
          var rtcpParameters = SDPUtils.parseRtcpParameters(mediaSection);
    
          var isComplete = SDPUtils.matchPrefix(mediaSection,
              'a=end-of-candidates', sessionpart).length > 0;
          var cands = SDPUtils.matchPrefix(mediaSection, 'a=candidate:')
              .map(function(cand) {
                return SDPUtils.parseCandidate(cand);
              })
              .filter(function(cand) {
                return cand.component === 1;
              });
    
          // Check if we can use BUNDLE and dispose transports.
          if ((description.type === 'offer' || description.type === 'answer') &&
              !rejected && usingBundle && sdpMLineIndex > 0 &&
              pc.transceivers[sdpMLineIndex]) {
            pc._disposeIceAndDtlsTransports(sdpMLineIndex);
            pc.transceivers[sdpMLineIndex].iceGatherer =
                pc.transceivers[0].iceGatherer;
            pc.transceivers[sdpMLineIndex].iceTransport =
                pc.transceivers[0].iceTransport;
            pc.transceivers[sdpMLineIndex].dtlsTransport =
                pc.transceivers[0].dtlsTransport;
            if (pc.transceivers[sdpMLineIndex].rtpSender) {
              pc.transceivers[sdpMLineIndex].rtpSender.setTransport(
                  pc.transceivers[0].dtlsTransport);
            }
            if (pc.transceivers[sdpMLineIndex].rtpReceiver) {
              pc.transceivers[sdpMLineIndex].rtpReceiver.setTransport(
                  pc.transceivers[0].dtlsTransport);
            }
          }
          if (description.type === 'offer' && !rejected) {
            transceiver = pc.transceivers[sdpMLineIndex] ||
                pc._createTransceiver(kind);
            transceiver.mid = mid;
    
            if (!transceiver.iceGatherer) {
              transceiver.iceGatherer = pc._createIceGatherer(sdpMLineIndex,
                  usingBundle);
            }
    
            if (cands.length && transceiver.iceTransport.state === 'new') {
              if (isComplete && (!usingBundle || sdpMLineIndex === 0)) {
                transceiver.iceTransport.setRemoteCandidates(cands);
              } else {
                cands.forEach(function(candidate) {
                  maybeAddCandidate(transceiver.iceTransport, candidate);
                });
              }
            }
    
            localCapabilities = window.RTCRtpReceiver.getCapabilities(kind);
    
            // filter RTX until additional stuff needed for RTX is implemented
            // in adapter.js
            if (edgeVersion < 15019) {
              localCapabilities.codecs = localCapabilities.codecs.filter(
                  function(codec) {
                    return codec.name !== 'rtx';
                  });
            }
    
            sendEncodingParameters = transceiver.sendEncodingParameters || [{
              ssrc: (2 * sdpMLineIndex + 2) * 1001
            }];
    
            // TODO: rewrite to use http://w3c.github.io/webrtc-pc/#set-associated-remote-streams
            var isNewTrack = false;
            if (direction === 'sendrecv' || direction === 'sendonly') {
              isNewTrack = !transceiver.rtpReceiver;
              rtpReceiver = transceiver.rtpReceiver ||
                  new window.RTCRtpReceiver(transceiver.dtlsTransport, kind);
    
              if (isNewTrack) {
                var stream;
                track = rtpReceiver.track;
                // FIXME: does not work with Plan B.
                if (remoteMsid && remoteMsid.stream === '-') {
                  // no-op. a stream id of '-' means: no associated stream.
                } else if (remoteMsid) {
                  if (!streams[remoteMsid.stream]) {
                    streams[remoteMsid.stream] = new window.MediaStream();
                    Object.defineProperty(streams[remoteMsid.stream], 'id', {
                      get: function() {
                        return remoteMsid.stream;
                      }
                    });
                  }
                  Object.defineProperty(track, 'id', {
                    get: function() {
                      return remoteMsid.track;
                    }
                  });
                  stream = streams[remoteMsid.stream];
                } else {
                  if (!streams.default) {
                    streams.default = new window.MediaStream();
                  }
                  stream = streams.default;
                }
                if (stream) {
                  addTrackToStreamAndFireEvent(track, stream);
                  transceiver.associatedRemoteMediaStreams.push(stream);
                }
                receiverList.push([track, rtpReceiver, stream]);
              }
            } else if (transceiver.rtpReceiver && transceiver.rtpReceiver.track) {
              transceiver.associatedRemoteMediaStreams.forEach(function(s) {
                var nativeTrack = s.getTracks().find(function(t) {
                  return t.id === transceiver.rtpReceiver.track.id;
                });
                if (nativeTrack) {
                  removeTrackFromStreamAndFireEvent(nativeTrack, s);
                }
              });
              transceiver.associatedRemoteMediaStreams = [];
            }
    
            transceiver.localCapabilities = localCapabilities;
            transceiver.remoteCapabilities = remoteCapabilities;
            transceiver.rtpReceiver = rtpReceiver;
            transceiver.rtcpParameters = rtcpParameters;
            transceiver.sendEncodingParameters = sendEncodingParameters;
            transceiver.recvEncodingParameters = recvEncodingParameters;
    
            // Start the RTCRtpReceiver now. The RTPSender is started in
            // setLocalDescription.
            pc._transceive(pc.transceivers[sdpMLineIndex],
                false,
                isNewTrack);
          } else if (description.type === 'answer' && !rejected) {
            transceiver = pc.transceivers[sdpMLineIndex];
            iceGatherer = transceiver.iceGatherer;
            iceTransport = transceiver.iceTransport;
            dtlsTransport = transceiver.dtlsTransport;
            rtpReceiver = transceiver.rtpReceiver;
            sendEncodingParameters = transceiver.sendEncodingParameters;
            localCapabilities = transceiver.localCapabilities;
    
            pc.transceivers[sdpMLineIndex].recvEncodingParameters =
                recvEncodingParameters;
            pc.transceivers[sdpMLineIndex].remoteCapabilities =
                remoteCapabilities;
            pc.transceivers[sdpMLineIndex].rtcpParameters = rtcpParameters;
    
            if (cands.length && iceTransport.state === 'new') {
              if ((isIceLite || isComplete) &&
                  (!usingBundle || sdpMLineIndex === 0)) {
                iceTransport.setRemoteCandidates(cands);
              } else {
                cands.forEach(function(candidate) {
                  maybeAddCandidate(transceiver.iceTransport, candidate);
                });
              }
            }
    
            if (!usingBundle || sdpMLineIndex === 0) {
              if (iceTransport.state === 'new') {
                iceTransport.start(iceGatherer, remoteIceParameters,
                    'controlling');
              }
              if (dtlsTransport.state === 'new') {
                dtlsTransport.start(remoteDtlsParameters);
              }
            }
    
            // If the offer contained RTX but the answer did not,
            // remove RTX from sendEncodingParameters.
            var commonCapabilities = getCommonCapabilities(
              transceiver.localCapabilities,
              transceiver.remoteCapabilities);
    
            var hasRtx = commonCapabilities.codecs.filter(function(c) {
              return c.name.toLowerCase() === 'rtx';
            }).length;
            if (!hasRtx && transceiver.sendEncodingParameters[0].rtx) {
              delete transceiver.sendEncodingParameters[0].rtx;
            }
    
            pc._transceive(transceiver,
                direction === 'sendrecv' || direction === 'recvonly',
                direction === 'sendrecv' || direction === 'sendonly');
    
            // TODO: rewrite to use http://w3c.github.io/webrtc-pc/#set-associated-remote-streams
            if (rtpReceiver &&
                (direction === 'sendrecv' || direction === 'sendonly')) {
              track = rtpReceiver.track;
              if (remoteMsid) {
                if (!streams[remoteMsid.stream]) {
                  streams[remoteMsid.stream] = new window.MediaStream();
                }
                addTrackToStreamAndFireEvent(track, streams[remoteMsid.stream]);
                receiverList.push([track, rtpReceiver, streams[remoteMsid.stream]]);
              } else {
                if (!streams.default) {
                  streams.default = new window.MediaStream();
                }
                addTrackToStreamAndFireEvent(track, streams.default);
                receiverList.push([track, rtpReceiver, streams.default]);
              }
            } else {
              // FIXME: actually the receiver should be created later.
              delete transceiver.rtpReceiver;
            }
          }
        });
    
        if (pc._dtlsRole === undefined) {
          pc._dtlsRole = description.type === 'offer' ? 'active' : 'passive';
        }
    
        pc._remoteDescription = {
          type: description.type,
          sdp: description.sdp
        };
        if (description.type === 'offer') {
          pc._updateSignalingState('have-remote-offer');
        } else {
          pc._updateSignalingState('stable');
        }
        Object.keys(streams).forEach(function(sid) {
          var stream = streams[sid];
          if (stream.getTracks().length) {
            if (pc.remoteStreams.indexOf(stream) === -1) {
              pc.remoteStreams.push(stream);
              var event = new Event('addstream');
              event.stream = stream;
              window.setTimeout(function() {
                pc._dispatchEvent('addstream', event);
              });
            }
    
            receiverList.forEach(function(item) {
              var track = item[0];
              var receiver = item[1];
              if (stream.id !== item[2].id) {
                return;
              }
              fireAddTrack(pc, track, receiver, [stream]);
            });
          }
        });
        receiverList.forEach(function(item) {
          if (item[2]) {
            return;
          }
          fireAddTrack(pc, item[0], item[1], []);
        });
    
        // check whether addIceCandidate({}) was called within four seconds after
        // setRemoteDescription.
        window.setTimeout(function() {
          if (!(pc && pc.transceivers)) {
            return;
          }
          pc.transceivers.forEach(function(transceiver) {
            if (transceiver.iceTransport &&
                transceiver.iceTransport.state === 'new' &&
                transceiver.iceTransport.getRemoteCandidates().length > 0) {
              console.warn('Timeout for addRemoteCandidate. Consider sending ' +
                  'an end-of-candidates notification');
              transceiver.iceTransport.addRemoteCandidate({});
            }
          });
        }, 4000);
    
        return Promise.resolve();
      };
    
      RTCPeerConnection.prototype.close = function() {
        this.transceivers.forEach(function(transceiver) {
          /* not yet
          if (transceiver.iceGatherer) {
            transceiver.iceGatherer.close();
          }
          */
          if (transceiver.iceTransport) {
            transceiver.iceTransport.stop();
          }
          if (transceiver.dtlsTransport) {
            transceiver.dtlsTransport.stop();
          }
          if (transceiver.rtpSender) {
            transceiver.rtpSender.stop();
          }
          if (transceiver.rtpReceiver) {
            transceiver.rtpReceiver.stop();
          }
        });
        // FIXME: clean up tracks, local streams, remote streams, etc
        this._isClosed = true;
        this._updateSignalingState('closed');
      };
    
      // Update the signaling state.
      RTCPeerConnection.prototype._updateSignalingState = function(newState) {
        this.signalingState = newState;
        var event = new Event('signalingstatechange');
        this._dispatchEvent('signalingstatechange', event);
      };
    
      // Determine whether to fire the negotiationneeded event.
      RTCPeerConnection.prototype._maybeFireNegotiationNeeded = function() {
        var pc = this;
        if (this.signalingState !== 'stable' || this.needNegotiation === true) {
          return;
        }
        this.needNegotiation = true;
        window.setTimeout(function() {
          if (pc.needNegotiation) {
            pc.needNegotiation = false;
            var event = new Event('negotiationneeded');
            pc._dispatchEvent('negotiationneeded', event);
          }
        }, 0);
      };
    
      // Update the ice connection state.
      RTCPeerConnection.prototype._updateIceConnectionState = function() {
        var newState;
        var states = {
          'new': 0,
          closed: 0,
          checking: 0,
          connected: 0,
          completed: 0,
          disconnected: 0,
          failed: 0
        };
        this.transceivers.forEach(function(transceiver) {
          states[transceiver.iceTransport.state]++;
        });
    
        newState = 'new';
        if (states.failed > 0) {
          newState = 'failed';
        } else if (states.checking > 0) {
          newState = 'checking';
        } else if (states.disconnected > 0) {
          newState = 'disconnected';
        } else if (states.new > 0) {
          newState = 'new';
        } else if (states.connected > 0) {
          newState = 'connected';
        } else if (states.completed > 0) {
          newState = 'completed';
        }
    
        if (newState !== this.iceConnectionState) {
          this.iceConnectionState = newState;
          var event = new Event('iceconnectionstatechange');
          this._dispatchEvent('iceconnectionstatechange', event);
        }
      };
    
      // Update the connection state.
      RTCPeerConnection.prototype._updateConnectionState = function() {
        var newState;
        var states = {
          'new': 0,
          closed: 0,
          connecting: 0,
          connected: 0,
          completed: 0,
          disconnected: 0,
          failed: 0
        };
        this.transceivers.forEach(function(transceiver) {
          states[transceiver.iceTransport.state]++;
          states[transceiver.dtlsTransport.state]++;
        });
        // ICETransport.completed and connected are the same for this purpose.
        states.connected += states.completed;
    
        newState = 'new';
        if (states.failed > 0) {
          newState = 'failed';
        } else if (states.connecting > 0) {
          newState = 'connecting';
        } else if (states.disconnected > 0) {
          newState = 'disconnected';
        } else if (states.new > 0) {
          newState = 'new';
        } else if (states.connected > 0) {
          newState = 'connected';
        }
    
        if (newState !== this.connectionState) {
          this.connectionState = newState;
          var event = new Event('connectionstatechange');
          this._dispatchEvent('connectionstatechange', event);
        }
      };
    
      RTCPeerConnection.prototype.createOffer = function() {
        var pc = this;
    
        if (pc._isClosed) {
          return Promise.reject(makeError('InvalidStateError',
              'Can not call createOffer after close'));
        }
    
        var numAudioTracks = pc.transceivers.filter(function(t) {
          return t.kind === 'audio';
        }).length;
        var numVideoTracks = pc.transceivers.filter(function(t) {
          return t.kind === 'video';
        }).length;
    
        // Determine number of audio and video tracks we need to send/recv.
        var offerOptions = arguments[0];
        if (offerOptions) {
          // Reject Chrome legacy constraints.
          if (offerOptions.mandatory || offerOptions.optional) {
            throw new TypeError(
                'Legacy mandatory/optional constraints not supported.');
          }
          if (offerOptions.offerToReceiveAudio !== undefined) {
            if (offerOptions.offerToReceiveAudio === true) {
              numAudioTracks = 1;
            } else if (offerOptions.offerToReceiveAudio === false) {
              numAudioTracks = 0;
            } else {
              numAudioTracks = offerOptions.offerToReceiveAudio;
            }
          }
          if (offerOptions.offerToReceiveVideo !== undefined) {
            if (offerOptions.offerToReceiveVideo === true) {
              numVideoTracks = 1;
            } else if (offerOptions.offerToReceiveVideo === false) {
              numVideoTracks = 0;
            } else {
              numVideoTracks = offerOptions.offerToReceiveVideo;
            }
          }
        }
    
        pc.transceivers.forEach(function(transceiver) {
          if (transceiver.kind === 'audio') {
            numAudioTracks--;
            if (numAudioTracks < 0) {
              transceiver.wantReceive = false;
            }
          } else if (transceiver.kind === 'video') {
            numVideoTracks--;
            if (numVideoTracks < 0) {
              transceiver.wantReceive = false;
            }
          }
        });
    
        // Create M-lines for recvonly streams.
        while (numAudioTracks > 0 || numVideoTracks > 0) {
          if (numAudioTracks > 0) {
            pc._createTransceiver('audio');
            numAudioTracks--;
          }
          if (numVideoTracks > 0) {
            pc._createTransceiver('video');
            numVideoTracks--;
          }
        }
    
        var sdp = SDPUtils.writeSessionBoilerplate(pc._sdpSessionId,
            pc._sdpSessionVersion++);
        pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
          // For each track, create an ice gatherer, ice transport,
          // dtls transport, potentially rtpsender and rtpreceiver.
          var track = transceiver.track;
          var kind = transceiver.kind;
          var mid = transceiver.mid || SDPUtils.generateIdentifier();
          transceiver.mid = mid;
    
          if (!transceiver.iceGatherer) {
            transceiver.iceGatherer = pc._createIceGatherer(sdpMLineIndex,
                pc.usingBundle);
          }
    
          var localCapabilities = window.RTCRtpSender.getCapabilities(kind);
          // filter RTX until additional stuff needed for RTX is implemented
          // in adapter.js
          if (edgeVersion < 15019) {
            localCapabilities.codecs = localCapabilities.codecs.filter(
                function(codec) {
                  return codec.name !== 'rtx';
                });
          }
          localCapabilities.codecs.forEach(function(codec) {
            // work around https://bugs.chromium.org/p/webrtc/issues/detail?id=6552
            // by adding level-asymmetry-allowed=1
            if (codec.name === 'H264' &&
                codec.parameters['level-asymmetry-allowed'] === undefined) {
              codec.parameters['level-asymmetry-allowed'] = '1';
            }
    
            // for subsequent offers, we might have to re-use the payload
            // type of the last offer.
            if (transceiver.remoteCapabilities &&
                transceiver.remoteCapabilities.codecs) {
              transceiver.remoteCapabilities.codecs.forEach(function(remoteCodec) {
                if (codec.name.toLowerCase() === remoteCodec.name.toLowerCase() &&
                    codec.clockRate === remoteCodec.clockRate) {
                  codec.preferredPayloadType = remoteCodec.payloadType;
                }
              });
            }
          });
          localCapabilities.headerExtensions.forEach(function(hdrExt) {
            var remoteExtensions = transceiver.remoteCapabilities &&
                transceiver.remoteCapabilities.headerExtensions || [];
            remoteExtensions.forEach(function(rHdrExt) {
              if (hdrExt.uri === rHdrExt.uri) {
                hdrExt.id = rHdrExt.id;
              }
            });
          });
    
          // generate an ssrc now, to be used later in rtpSender.send
          var sendEncodingParameters = transceiver.sendEncodingParameters || [{
            ssrc: (2 * sdpMLineIndex + 1) * 1001
          }];
          if (track) {
            // add RTX
            if (edgeVersion >= 15019 && kind === 'video' &&
                !sendEncodingParameters[0].rtx) {
              sendEncodingParameters[0].rtx = {
                ssrc: sendEncodingParameters[0].ssrc + 1
              };
            }
          }
    
          if (transceiver.wantReceive) {
            transceiver.rtpReceiver = new window.RTCRtpReceiver(
                transceiver.dtlsTransport, kind);
          }
    
          transceiver.localCapabilities = localCapabilities;
          transceiver.sendEncodingParameters = sendEncodingParameters;
        });
    
        // always offer BUNDLE and dispose on return if not supported.
        if (pc._config.bundlePolicy !== 'max-compat') {
          sdp += 'a=group:BUNDLE ' + pc.transceivers.map(function(t) {
            return t.mid;
          }).join(' ') + '\r\n';
        }
        sdp += 'a=ice-options:trickle\r\n';
    
        pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
          sdp += writeMediaSection(transceiver, transceiver.localCapabilities,
              'offer', transceiver.stream, pc._dtlsRole);
          sdp += 'a=rtcp-rsize\r\n';
    
          if (transceiver.iceGatherer && pc.iceGatheringState !== 'new' &&
              (sdpMLineIndex === 0 || !pc.usingBundle)) {
            transceiver.iceGatherer.getLocalCandidates().forEach(function(cand) {
              cand.component = 1;
              sdp += 'a=' + SDPUtils.writeCandidate(cand) + '\r\n';
            });
    
            if (transceiver.iceGatherer.state === 'completed') {
              sdp += 'a=end-of-candidates\r\n';
            }
          }
        });
    
        var desc = new window.RTCSessionDescription({
          type: 'offer',
          sdp: sdp
        });
        return Promise.resolve(desc);
      };
    
      RTCPeerConnection.prototype.createAnswer = function() {
        var pc = this;
    
        if (pc._isClosed) {
          return Promise.reject(makeError('InvalidStateError',
              'Can not call createAnswer after close'));
        }
    
        if (!(pc.signalingState === 'have-remote-offer' ||
            pc.signalingState === 'have-local-pranswer')) {
          return Promise.reject(makeError('InvalidStateError',
              'Can not call createAnswer in signalingState ' + pc.signalingState));
        }
    
        var sdp = SDPUtils.writeSessionBoilerplate(pc._sdpSessionId,
            pc._sdpSessionVersion++);
        if (pc.usingBundle) {
          sdp += 'a=group:BUNDLE ' + pc.transceivers.map(function(t) {
            return t.mid;
          }).join(' ') + '\r\n';
        }
        sdp += 'a=ice-options:trickle\r\n';
    
        var mediaSectionsInOffer = SDPUtils.getMediaSections(
            pc._remoteDescription.sdp).length;
        pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
          if (sdpMLineIndex + 1 > mediaSectionsInOffer) {
            return;
          }
          if (transceiver.rejected) {
            if (transceiver.kind === 'application') {
              if (transceiver.protocol === 'DTLS/SCTP') { // legacy fmt
                sdp += 'm=application 0 DTLS/SCTP 5000\r\n';
              } else {
                sdp += 'm=application 0 ' + transceiver.protocol +
                    ' webrtc-datachannel\r\n';
              }
            } else if (transceiver.kind === 'audio') {
              sdp += 'm=audio 0 UDP/TLS/RTP/SAVPF 0\r\n' +
                  'a=rtpmap:0 PCMU/8000\r\n';
            } else if (transceiver.kind === 'video') {
              sdp += 'm=video 0 UDP/TLS/RTP/SAVPF 120\r\n' +
                  'a=rtpmap:120 VP8/90000\r\n';
            }
            sdp += 'c=IN IP4 0.0.0.0\r\n' +
                'a=inactive\r\n' +
                'a=mid:' + transceiver.mid + '\r\n';
            return;
          }
    
          // FIXME: look at direction.
          if (transceiver.stream) {
            var localTrack;
            if (transceiver.kind === 'audio') {
              localTrack = transceiver.stream.getAudioTracks()[0];
            } else if (transceiver.kind === 'video') {
              localTrack = transceiver.stream.getVideoTracks()[0];
            }
            if (localTrack) {
              // add RTX
              if (edgeVersion >= 15019 && transceiver.kind === 'video' &&
                  !transceiver.sendEncodingParameters[0].rtx) {
                transceiver.sendEncodingParameters[0].rtx = {
                  ssrc: transceiver.sendEncodingParameters[0].ssrc + 1
                };
              }
            }
          }
    
          // Calculate intersection of capabilities.
          var commonCapabilities = getCommonCapabilities(
              transceiver.localCapabilities,
              transceiver.remoteCapabilities);
    
          var hasRtx = commonCapabilities.codecs.filter(function(c) {
            return c.name.toLowerCase() === 'rtx';
          }).length;
          if (!hasRtx && transceiver.sendEncodingParameters[0].rtx) {
            delete transceiver.sendEncodingParameters[0].rtx;
          }
    
          sdp += writeMediaSection(transceiver, commonCapabilities,
              'answer', transceiver.stream, pc._dtlsRole);
          if (transceiver.rtcpParameters &&
              transceiver.rtcpParameters.reducedSize) {
            sdp += 'a=rtcp-rsize\r\n';
          }
        });
    
        var desc = new window.RTCSessionDescription({
          type: 'answer',
          sdp: sdp
        });
        return Promise.resolve(desc);
      };
    
      RTCPeerConnection.prototype.addIceCandidate = function(candidate) {
        var pc = this;
        var sections;
        if (candidate && !(candidate.sdpMLineIndex !== undefined ||
            candidate.sdpMid)) {
          return Promise.reject(new TypeError('sdpMLineIndex or sdpMid required'));
        }
    
        // TODO: needs to go into ops queue.
        return new Promise(function(resolve, reject) {
          if (!pc._remoteDescription) {
            return reject(makeError('InvalidStateError',
                'Can not add ICE candidate without a remote description'));
          } else if (!candidate || candidate.candidate === '') {
            for (var j = 0; j < pc.transceivers.length; j++) {
              if (pc.transceivers[j].rejected) {
                continue;
              }
              pc.transceivers[j].iceTransport.addRemoteCandidate({});
              sections = SDPUtils.getMediaSections(pc._remoteDescription.sdp);
              sections[j] += 'a=end-of-candidates\r\n';
              pc._remoteDescription.sdp =
                  SDPUtils.getDescription(pc._remoteDescription.sdp) +
                  sections.join('');
              if (pc.usingBundle) {
                break;
              }
            }
          } else {
            var sdpMLineIndex = candidate.sdpMLineIndex;
            if (candidate.sdpMid) {
              for (var i = 0; i < pc.transceivers.length; i++) {
                if (pc.transceivers[i].mid === candidate.sdpMid) {
                  sdpMLineIndex = i;
                  break;
                }
              }
            }
            var transceiver = pc.transceivers[sdpMLineIndex];
            if (transceiver) {
              if (transceiver.rejected) {
                return resolve();
              }
              var cand = Object.keys(candidate.candidate).length > 0 ?
                  SDPUtils.parseCandidate(candidate.candidate) : {};
              // Ignore Chrome's invalid candidates since Edge does not like them.
              if (cand.protocol === 'tcp' && (cand.port === 0 || cand.port === 9)) {
                return resolve();
              }
              // Ignore RTCP candidates, we assume RTCP-MUX.
              if (cand.component && cand.component !== 1) {
                return resolve();
              }
              // when using bundle, avoid adding candidates to the wrong
              // ice transport. And avoid adding candidates added in the SDP.
              if (sdpMLineIndex === 0 || (sdpMLineIndex > 0 &&
                  transceiver.iceTransport !== pc.transceivers[0].iceTransport)) {
                if (!maybeAddCandidate(transceiver.iceTransport, cand)) {
                  return reject(makeError('OperationError',
                      'Can not add ICE candidate'));
                }
              }
    
              // update the remoteDescription.
              var candidateString = candidate.candidate.trim();
              if (candidateString.indexOf('a=') === 0) {
                candidateString = candidateString.substr(2);
              }
              sections = SDPUtils.getMediaSections(pc._remoteDescription.sdp);
              sections[sdpMLineIndex] += 'a=' +
                  (cand.type ? candidateString : 'end-of-candidates')
                  + '\r\n';
              pc._remoteDescription.sdp =
                  SDPUtils.getDescription(pc._remoteDescription.sdp) +
                  sections.join('');
            } else {
              return reject(makeError('OperationError',
                  'Can not add ICE candidate'));
            }
          }
          resolve();
        });
      };
    
      RTCPeerConnection.prototype.getStats = function(selector) {
        if (selector && selector instanceof window.MediaStreamTrack) {
          var senderOrReceiver = null;
          this.transceivers.forEach(function(transceiver) {
            if (transceiver.rtpSender &&
                transceiver.rtpSender.track === selector) {
              senderOrReceiver = transceiver.rtpSender;
            } else if (transceiver.rtpReceiver &&
                transceiver.rtpReceiver.track === selector) {
              senderOrReceiver = transceiver.rtpReceiver;
            }
          });
          if (!senderOrReceiver) {
            throw makeError('InvalidAccessError', 'Invalid selector.');
          }
          return senderOrReceiver.getStats();
        }
    
        var promises = [];
        this.transceivers.forEach(function(transceiver) {
          ['rtpSender', 'rtpReceiver', 'iceGatherer', 'iceTransport',
              'dtlsTransport'].forEach(function(method) {
                if (transceiver[method]) {
                  promises.push(transceiver[method].getStats());
                }
              });
        });
        return Promise.all(promises).then(function(allStats) {
          var results = new Map();
          allStats.forEach(function(stats) {
            stats.forEach(function(stat) {
              results.set(stat.id, stat);
            });
          });
          return results;
        });
      };
    
      // fix low-level stat names and return Map instead of object.
      var ortcObjects = ['RTCRtpSender', 'RTCRtpReceiver', 'RTCIceGatherer',
        'RTCIceTransport', 'RTCDtlsTransport'];
      ortcObjects.forEach(function(ortcObjectName) {
        var obj = window[ortcObjectName];
        if (obj && obj.prototype && obj.prototype.getStats) {
          var nativeGetstats = obj.prototype.getStats;
          obj.prototype.getStats = function() {
            return nativeGetstats.apply(this)
            .then(function(nativeStats) {
              var mapStats = new Map();
              Object.keys(nativeStats).forEach(function(id) {
                nativeStats[id].type = fixStatsType(nativeStats[id]);
                mapStats.set(id, nativeStats[id]);
              });
              return mapStats;
            });
          };
        }
      });
    
      // legacy callback shims. Should be moved to adapter.js some days.
      var methods = ['createOffer', 'createAnswer'];
      methods.forEach(function(method) {
        var nativeMethod = RTCPeerConnection.prototype[method];
        RTCPeerConnection.prototype[method] = function() {
          var args = arguments;
          if (typeof args[0] === 'function' ||
              typeof args[1] === 'function') { // legacy
            return nativeMethod.apply(this, [arguments[2]])
            .then(function(description) {
              if (typeof args[0] === 'function') {
                args[0].apply(null, [description]);
              }
            }, function(error) {
              if (typeof args[1] === 'function') {
                args[1].apply(null, [error]);
              }
            });
          }
          return nativeMethod.apply(this, arguments);
        };
      });
    
      methods = ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate'];
      methods.forEach(function(method) {
        var nativeMethod = RTCPeerConnection.prototype[method];
        RTCPeerConnection.prototype[method] = function() {
          var args = arguments;
          if (typeof args[1] === 'function' ||
              typeof args[2] === 'function') { // legacy
            return nativeMethod.apply(this, arguments)
            .then(function() {
              if (typeof args[1] === 'function') {
                args[1].apply(null);
              }
            }, function(error) {
              if (typeof args[2] === 'function') {
                args[2].apply(null, [error]);
              }
            });
          }
          return nativeMethod.apply(this, arguments);
        };
      });
    
      // getStats is special. It doesn't have a spec legacy method yet we support
      // getStats(something, cb) without error callbacks.
      ['getStats'].forEach(function(method) {
        var nativeMethod = RTCPeerConnection.prototype[method];
        RTCPeerConnection.prototype[method] = function() {
          var args = arguments;
          if (typeof args[1] === 'function') {
            return nativeMethod.apply(this, arguments)
            .then(function() {
              if (typeof args[1] === 'function') {
                args[1].apply(null);
              }
            });
          }
          return nativeMethod.apply(this, arguments);
        };
      });
    
      return RTCPeerConnection;
    };
    
    },{"sdp":2}],2:[function(require,module,exports){
     /* eslint-env node */
    'use strict';
    
    // SDP helpers.
    var SDPUtils = {};
    
    // Generate an alphanumeric identifier for cname or mids.
    // TODO: use UUIDs instead? https://gist.github.com/jed/982883
    SDPUtils.generateIdentifier = function() {
      return Math.random().toString(36).substr(2, 10);
    };
    
    // The RTCP CNAME used by all peerconnections from the same JS.
    SDPUtils.localCName = SDPUtils.generateIdentifier();
    
    // Splits SDP into lines, dealing with both CRLF and LF.
    SDPUtils.splitLines = function(blob) {
      return blob.trim().split('\n').map(function(line) {
        return line.trim();
      });
    };
    // Splits SDP into sessionpart and mediasections. Ensures CRLF.
    SDPUtils.splitSections = function(blob) {
      var parts = blob.split('\nm=');
      return parts.map(function(part, index) {
        return (index > 0 ? 'm=' + part : part).trim() + '\r\n';
      });
    };
    
    // returns the session description.
    SDPUtils.getDescription = function(blob) {
      var sections = SDPUtils.splitSections(blob);
      return sections && sections[0];
    };
    
    // returns the individual media sections.
    SDPUtils.getMediaSections = function(blob) {
      var sections = SDPUtils.splitSections(blob);
      sections.shift();
      return sections;
    };
    
    // Returns lines that start with a certain prefix.
    SDPUtils.matchPrefix = function(blob, prefix) {
      return SDPUtils.splitLines(blob).filter(function(line) {
        return line.indexOf(prefix) === 0;
      });
    };
    
    // Parses an ICE candidate line. Sample input:
    // candidate:702786350 2 udp 41819902 8.8.8.8 60769 typ relay raddr 8.8.8.8
    // rport 55996"
    SDPUtils.parseCandidate = function(line) {
      var parts;
      // Parse both variants.
      if (line.indexOf('a=candidate:') === 0) {
        parts = line.substring(12).split(' ');
      } else {
        parts = line.substring(10).split(' ');
      }
    
      var candidate = {
        foundation: parts[0],
        component: parseInt(parts[1], 10),
        protocol: parts[2].toLowerCase(),
        priority: parseInt(parts[3], 10),
        ip: parts[4],
        address: parts[4], // address is an alias for ip.
        port: parseInt(parts[5], 10),
        // skip parts[6] == 'typ'
        type: parts[7]
      };
    
      for (var i = 8; i < parts.length; i += 2) {
        switch (parts[i]) {
          case 'raddr':
            candidate.relatedAddress = parts[i + 1];
            break;
          case 'rport':
            candidate.relatedPort = parseInt(parts[i + 1], 10);
            break;
          case 'tcptype':
            candidate.tcpType = parts[i + 1];
            break;
          case 'ufrag':
            candidate.ufrag = parts[i + 1]; // for backward compability.
            candidate.usernameFragment = parts[i + 1];
            break;
          default: // extension handling, in particular ufrag
            candidate[parts[i]] = parts[i + 1];
            break;
        }
      }
      return candidate;
    };
    
    // Translates a candidate object into SDP candidate attribute.
    SDPUtils.writeCandidate = function(candidate) {
      var sdp = [];
      sdp.push(candidate.foundation);
      sdp.push(candidate.component);
      sdp.push(candidate.protocol.toUpperCase());
      sdp.push(candidate.priority);
      sdp.push(candidate.address || candidate.ip);
      sdp.push(candidate.port);
    
      var type = candidate.type;
      sdp.push('typ');
      sdp.push(type);
      if (type !== 'host' && candidate.relatedAddress &&
          candidate.relatedPort) {
        sdp.push('raddr');
        sdp.push(candidate.relatedAddress);
        sdp.push('rport');
        sdp.push(candidate.relatedPort);
      }
      if (candidate.tcpType && candidate.protocol.toLowerCase() === 'tcp') {
        sdp.push('tcptype');
        sdp.push(candidate.tcpType);
      }
      if (candidate.usernameFragment || candidate.ufrag) {
        sdp.push('ufrag');
        sdp.push(candidate.usernameFragment || candidate.ufrag);
      }
      return 'candidate:' + sdp.join(' ');
    };
    
    // Parses an ice-options line, returns an array of option tags.
    // a=ice-options:foo bar
    SDPUtils.parseIceOptions = function(line) {
      return line.substr(14).split(' ');
    };
    
    // Parses an rtpmap line, returns RTCRtpCoddecParameters. Sample input:
    // a=rtpmap:111 opus/48000/2
    SDPUtils.parseRtpMap = function(line) {
      var parts = line.substr(9).split(' ');
      var parsed = {
        payloadType: parseInt(parts.shift(), 10) // was: id
      };
    
      parts = parts[0].split('/');
    
      parsed.name = parts[0];
      parsed.clockRate = parseInt(parts[1], 10); // was: clockrate
      parsed.channels = parts.length === 3 ? parseInt(parts[2], 10) : 1;
      // legacy alias, got renamed back to channels in ORTC.
      parsed.numChannels = parsed.channels;
      return parsed;
    };
    
    // Generate an a=rtpmap line from RTCRtpCodecCapability or
    // RTCRtpCodecParameters.
    SDPUtils.writeRtpMap = function(codec) {
      var pt = codec.payloadType;
      if (codec.preferredPayloadType !== undefined) {
        pt = codec.preferredPayloadType;
      }
      var channels = codec.channels || codec.numChannels || 1;
      return 'a=rtpmap:' + pt + ' ' + codec.name + '/' + codec.clockRate +
          (channels !== 1 ? '/' + channels : '') + '\r\n';
    };
    
    // Parses an a=extmap line (headerextension from RFC 5285). Sample input:
    // a=extmap:2 urn:ietf:params:rtp-hdrext:toffset
    // a=extmap:2/sendonly urn:ietf:params:rtp-hdrext:toffset
    SDPUtils.parseExtmap = function(line) {
      var parts = line.substr(9).split(' ');
      return {
        id: parseInt(parts[0], 10),
        direction: parts[0].indexOf('/') > 0 ? parts[0].split('/')[1] : 'sendrecv',
        uri: parts[1]
      };
    };
    
    // Generates a=extmap line from RTCRtpHeaderExtensionParameters or
    // RTCRtpHeaderExtension.
    SDPUtils.writeExtmap = function(headerExtension) {
      return 'a=extmap:' + (headerExtension.id || headerExtension.preferredId) +
          (headerExtension.direction && headerExtension.direction !== 'sendrecv'
              ? '/' + headerExtension.direction
              : '') +
          ' ' + headerExtension.uri + '\r\n';
    };
    
    // Parses an ftmp line, returns dictionary. Sample input:
    // a=fmtp:96 vbr=on;cng=on
    // Also deals with vbr=on; cng=on
    SDPUtils.parseFmtp = function(line) {
      var parsed = {};
      var kv;
      var parts = line.substr(line.indexOf(' ') + 1).split(';');
      for (var j = 0; j < parts.length; j++) {
        kv = parts[j].trim().split('=');
        parsed[kv[0].trim()] = kv[1];
      }
      return parsed;
    };
    
    // Generates an a=ftmp line from RTCRtpCodecCapability or RTCRtpCodecParameters.
    SDPUtils.writeFmtp = function(codec) {
      var line = '';
      var pt = codec.payloadType;
      if (codec.preferredPayloadType !== undefined) {
        pt = codec.preferredPayloadType;
      }
      if (codec.parameters && Object.keys(codec.parameters).length) {
        var params = [];
        Object.keys(codec.parameters).forEach(function(param) {
          if (codec.parameters[param]) {
            params.push(param + '=' + codec.parameters[param]);
          } else {
            params.push(param);
          }
        });
        line += 'a=fmtp:' + pt + ' ' + params.join(';') + '\r\n';
      }
      return line;
    };
    
    // Parses an rtcp-fb line, returns RTCPRtcpFeedback object. Sample input:
    // a=rtcp-fb:98 nack rpsi
    SDPUtils.parseRtcpFb = function(line) {
      var parts = line.substr(line.indexOf(' ') + 1).split(' ');
      return {
        type: parts.shift(),
        parameter: parts.join(' ')
      };
    };
    // Generate a=rtcp-fb lines from RTCRtpCodecCapability or RTCRtpCodecParameters.
    SDPUtils.writeRtcpFb = function(codec) {
      var lines = '';
      var pt = codec.payloadType;
      if (codec.preferredPayloadType !== undefined) {
        pt = codec.preferredPayloadType;
      }
      if (codec.rtcpFeedback && codec.rtcpFeedback.length) {
        // FIXME: special handling for trr-int?
        codec.rtcpFeedback.forEach(function(fb) {
          lines += 'a=rtcp-fb:' + pt + ' ' + fb.type +
          (fb.parameter && fb.parameter.length ? ' ' + fb.parameter : '') +
              '\r\n';
        });
      }
      return lines;
    };
    
    // Parses an RFC 5576 ssrc media attribute. Sample input:
    // a=ssrc:3735928559 cname:something
    SDPUtils.parseSsrcMedia = function(line) {
      var sp = line.indexOf(' ');
      var parts = {
        ssrc: parseInt(line.substr(7, sp - 7), 10)
      };
      var colon = line.indexOf(':', sp);
      if (colon > -1) {
        parts.attribute = line.substr(sp + 1, colon - sp - 1);
        parts.value = line.substr(colon + 1);
      } else {
        parts.attribute = line.substr(sp + 1);
      }
      return parts;
    };
    
    SDPUtils.parseSsrcGroup = function(line) {
      var parts = line.substr(13).split(' ');
      return {
        semantics: parts.shift(),
        ssrcs: parts.map(function(ssrc) {
          return parseInt(ssrc, 10);
        })
      };
    };
    
    // Extracts the MID (RFC 5888) from a media section.
    // returns the MID or undefined if no mid line was found.
    SDPUtils.getMid = function(mediaSection) {
      var mid = SDPUtils.matchPrefix(mediaSection, 'a=mid:')[0];
      if (mid) {
        return mid.substr(6);
      }
    };
    
    SDPUtils.parseFingerprint = function(line) {
      var parts = line.substr(14).split(' ');
      return {
        algorithm: parts[0].toLowerCase(), // algorithm is case-sensitive in Edge.
        value: parts[1]
      };
    };
    
    // Extracts DTLS parameters from SDP media section or sessionpart.
    // FIXME: for consistency with other functions this should only
    //   get the fingerprint line as input. See also getIceParameters.
    SDPUtils.getDtlsParameters = function(mediaSection, sessionpart) {
      var lines = SDPUtils.matchPrefix(mediaSection + sessionpart,
          'a=fingerprint:');
      // Note: a=setup line is ignored since we use the 'auto' role.
      // Note2: 'algorithm' is not case sensitive except in Edge.
      return {
        role: 'auto',
        fingerprints: lines.map(SDPUtils.parseFingerprint)
      };
    };
    
    // Serializes DTLS parameters to SDP.
    SDPUtils.writeDtlsParameters = function(params, setupType) {
      var sdp = 'a=setup:' + setupType + '\r\n';
      params.fingerprints.forEach(function(fp) {
        sdp += 'a=fingerprint:' + fp.algorithm + ' ' + fp.value + '\r\n';
      });
      return sdp;
    };
    // Parses ICE information from SDP media section or sessionpart.
    // FIXME: for consistency with other functions this should only
    //   get the ice-ufrag and ice-pwd lines as input.
    SDPUtils.getIceParameters = function(mediaSection, sessionpart) {
      var lines = SDPUtils.splitLines(mediaSection);
      // Search in session part, too.
      lines = lines.concat(SDPUtils.splitLines(sessionpart));
      var iceParameters = {
        usernameFragment: lines.filter(function(line) {
          return line.indexOf('a=ice-ufrag:') === 0;
        })[0].substr(12),
        password: lines.filter(function(line) {
          return line.indexOf('a=ice-pwd:') === 0;
        })[0].substr(10)
      };
      return iceParameters;
    };
    
    // Serializes ICE parameters to SDP.
    SDPUtils.writeIceParameters = function(params) {
      return 'a=ice-ufrag:' + params.usernameFragment + '\r\n' +
          'a=ice-pwd:' + params.password + '\r\n';
    };
    
    // Parses the SDP media section and returns RTCRtpParameters.
    SDPUtils.parseRtpParameters = function(mediaSection) {
      var description = {
        codecs: [],
        headerExtensions: [],
        fecMechanisms: [],
        rtcp: []
      };
      var lines = SDPUtils.splitLines(mediaSection);
      var mline = lines[0].split(' ');
      for (var i = 3; i < mline.length; i++) { // find all codecs from mline[3..]
        var pt = mline[i];
        var rtpmapline = SDPUtils.matchPrefix(
            mediaSection, 'a=rtpmap:' + pt + ' ')[0];
        if (rtpmapline) {
          var codec = SDPUtils.parseRtpMap(rtpmapline);
          var fmtps = SDPUtils.matchPrefix(
              mediaSection, 'a=fmtp:' + pt + ' ');
          // Only the first a=fmtp:<pt> is considered.
          codec.parameters = fmtps.length ? SDPUtils.parseFmtp(fmtps[0]) : {};
          codec.rtcpFeedback = SDPUtils.matchPrefix(
              mediaSection, 'a=rtcp-fb:' + pt + ' ')
            .map(SDPUtils.parseRtcpFb);
          description.codecs.push(codec);
          // parse FEC mechanisms from rtpmap lines.
          switch (codec.name.toUpperCase()) {
            case 'RED':
            case 'ULPFEC':
              description.fecMechanisms.push(codec.name.toUpperCase());
              break;
            default: // only RED and ULPFEC are recognized as FEC mechanisms.
              break;
          }
        }
      }
      SDPUtils.matchPrefix(mediaSection, 'a=extmap:').forEach(function(line) {
        description.headerExtensions.push(SDPUtils.parseExtmap(line));
      });
      // FIXME: parse rtcp.
      return description;
    };
    
    // Generates parts of the SDP media section describing the capabilities /
    // parameters.
    SDPUtils.writeRtpDescription = function(kind, caps) {
      var sdp = '';
    
      // Build the mline.
      sdp += 'm=' + kind + ' ';
      sdp += caps.codecs.length > 0 ? '9' : '0'; // reject if no codecs.
      sdp += ' UDP/TLS/RTP/SAVPF ';
      sdp += caps.codecs.map(function(codec) {
        if (codec.preferredPayloadType !== undefined) {
          return codec.preferredPayloadType;
        }
        return codec.payloadType;
      }).join(' ') + '\r\n';
    
      sdp += 'c=IN IP4 0.0.0.0\r\n';
      sdp += 'a=rtcp:9 IN IP4 0.0.0.0\r\n';
    
      // Add a=rtpmap lines for each codec. Also fmtp and rtcp-fb.
      caps.codecs.forEach(function(codec) {
        sdp += SDPUtils.writeRtpMap(codec);
        sdp += SDPUtils.writeFmtp(codec);
        sdp += SDPUtils.writeRtcpFb(codec);
      });
      var maxptime = 0;
      caps.codecs.forEach(function(codec) {
        if (codec.maxptime > maxptime) {
          maxptime = codec.maxptime;
        }
      });
      if (maxptime > 0) {
        sdp += 'a=maxptime:' + maxptime + '\r\n';
      }
      sdp += 'a=rtcp-mux\r\n';
    
      if (caps.headerExtensions) {
        caps.headerExtensions.forEach(function(extension) {
          sdp += SDPUtils.writeExtmap(extension);
        });
      }
      // FIXME: write fecMechanisms.
      return sdp;
    };
    
    // Parses the SDP media section and returns an array of
    // RTCRtpEncodingParameters.
    SDPUtils.parseRtpEncodingParameters = function(mediaSection) {
      var encodingParameters = [];
      var description = SDPUtils.parseRtpParameters(mediaSection);
      var hasRed = description.fecMechanisms.indexOf('RED') !== -1;
      var hasUlpfec = description.fecMechanisms.indexOf('ULPFEC') !== -1;
    
      // filter a=ssrc:... cname:, ignore PlanB-msid
      var ssrcs = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
      .map(function(line) {
        return SDPUtils.parseSsrcMedia(line);
      })
      .filter(function(parts) {
        return parts.attribute === 'cname';
      });
      var primarySsrc = ssrcs.length > 0 && ssrcs[0].ssrc;
      var secondarySsrc;
    
      var flows = SDPUtils.matchPrefix(mediaSection, 'a=ssrc-group:FID')
      .map(function(line) {
        var parts = line.substr(17).split(' ');
        return parts.map(function(part) {
          return parseInt(part, 10);
        });
      });
      if (flows.length > 0 && flows[0].length > 1 && flows[0][0] === primarySsrc) {
        secondarySsrc = flows[0][1];
      }
    
      description.codecs.forEach(function(codec) {
        if (codec.name.toUpperCase() === 'RTX' && codec.parameters.apt) {
          var encParam = {
            ssrc: primarySsrc,
            codecPayloadType: parseInt(codec.parameters.apt, 10)
          };
          if (primarySsrc && secondarySsrc) {
            encParam.rtx = {ssrc: secondarySsrc};
          }
          encodingParameters.push(encParam);
          if (hasRed) {
            encParam = JSON.parse(JSON.stringify(encParam));
            encParam.fec = {
              ssrc: primarySsrc,
              mechanism: hasUlpfec ? 'red+ulpfec' : 'red'
            };
            encodingParameters.push(encParam);
          }
        }
      });
      if (encodingParameters.length === 0 && primarySsrc) {
        encodingParameters.push({
          ssrc: primarySsrc
        });
      }
    
      // we support both b=AS and b=TIAS but interpret AS as TIAS.
      var bandwidth = SDPUtils.matchPrefix(mediaSection, 'b=');
      if (bandwidth.length) {
        if (bandwidth[0].indexOf('b=TIAS:') === 0) {
          bandwidth = parseInt(bandwidth[0].substr(7), 10);
        } else if (bandwidth[0].indexOf('b=AS:') === 0) {
          // use formula from JSEP to convert b=AS to TIAS value.
          bandwidth = parseInt(bandwidth[0].substr(5), 10) * 1000 * 0.95
              - (50 * 40 * 8);
        } else {
          bandwidth = undefined;
        }
        encodingParameters.forEach(function(params) {
          params.maxBitrate = bandwidth;
        });
      }
      return encodingParameters;
    };
    
    // parses http://draft.ortc.org/#rtcrtcpparameters*
    SDPUtils.parseRtcpParameters = function(mediaSection) {
      var rtcpParameters = {};
    
      // Gets the first SSRC. Note tha with RTX there might be multiple
      // SSRCs.
      var remoteSsrc = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
          .map(function(line) {
            return SDPUtils.parseSsrcMedia(line);
          })
          .filter(function(obj) {
            return obj.attribute === 'cname';
          })[0];
      if (remoteSsrc) {
        rtcpParameters.cname = remoteSsrc.value;
        rtcpParameters.ssrc = remoteSsrc.ssrc;
      }
    
      // Edge uses the compound attribute instead of reducedSize
      // compound is !reducedSize
      var rsize = SDPUtils.matchPrefix(mediaSection, 'a=rtcp-rsize');
      rtcpParameters.reducedSize = rsize.length > 0;
      rtcpParameters.compound = rsize.length === 0;
    
      // parses the rtcp-mux attrіbute.
      // Note that Edge does not support unmuxed RTCP.
      var mux = SDPUtils.matchPrefix(mediaSection, 'a=rtcp-mux');
      rtcpParameters.mux = mux.length > 0;
    
      return rtcpParameters;
    };
    
    // parses either a=msid: or a=ssrc:... msid lines and returns
    // the id of the MediaStream and MediaStreamTrack.
    SDPUtils.parseMsid = function(mediaSection) {
      var parts;
      var spec = SDPUtils.matchPrefix(mediaSection, 'a=msid:');
      if (spec.length === 1) {
        parts = spec[0].substr(7).split(' ');
        return {stream: parts[0], track: parts[1]};
      }
      var planB = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
      .map(function(line) {
        return SDPUtils.parseSsrcMedia(line);
      })
      .filter(function(msidParts) {
        return msidParts.attribute === 'msid';
      });
      if (planB.length > 0) {
        parts = planB[0].value.split(' ');
        return {stream: parts[0], track: parts[1]};
      }
    };
    
    // Generate a session ID for SDP.
    // https://tools.ietf.org/html/draft-ietf-rtcweb-jsep-20#section-5.2.1
    // recommends using a cryptographically random +ve 64-bit value
    // but right now this should be acceptable and within the right range
    SDPUtils.generateSessionId = function() {
      return Math.random().toString().substr(2, 21);
    };
    
    // Write boilder plate for start of SDP
    // sessId argument is optional - if not supplied it will
    // be generated randomly
    // sessVersion is optional and defaults to 2
    // sessUser is optional and defaults to 'thisisadapterortc'
    SDPUtils.writeSessionBoilerplate = function(sessId, sessVer, sessUser) {
      var sessionId;
      var version = sessVer !== undefined ? sessVer : 2;
      if (sessId) {
        sessionId = sessId;
      } else {
        sessionId = SDPUtils.generateSessionId();
      }
      var user = sessUser || 'thisisadapterortc';
      // FIXME: sess-id should be an NTP timestamp.
      return 'v=0\r\n' +
          'o=' + user + ' ' + sessionId + ' ' + version +
            ' IN IP4 127.0.0.1\r\n' +
          's=-\r\n' +
          't=0 0\r\n';
    };
    
    SDPUtils.writeMediaSection = function(transceiver, caps, type, stream) {
      var sdp = SDPUtils.writeRtpDescription(transceiver.kind, caps);
    
      // Map ICE parameters (ufrag, pwd) to SDP.
      sdp += SDPUtils.writeIceParameters(
          transceiver.iceGatherer.getLocalParameters());
    
      // Map DTLS parameters to SDP.
      sdp += SDPUtils.writeDtlsParameters(
          transceiver.dtlsTransport.getLocalParameters(),
          type === 'offer' ? 'actpass' : 'active');
    
      sdp += 'a=mid:' + transceiver.mid + '\r\n';
    
      if (transceiver.direction) {
        sdp += 'a=' + transceiver.direction + '\r\n';
      } else if (transceiver.rtpSender && transceiver.rtpReceiver) {
        sdp += 'a=sendrecv\r\n';
      } else if (transceiver.rtpSender) {
        sdp += 'a=sendonly\r\n';
      } else if (transceiver.rtpReceiver) {
        sdp += 'a=recvonly\r\n';
      } else {
        sdp += 'a=inactive\r\n';
      }
    
      if (transceiver.rtpSender) {
        // spec.
        var msid = 'msid:' + stream.id + ' ' +
            transceiver.rtpSender.track.id + '\r\n';
        sdp += 'a=' + msid;
    
        // for Chrome.
        sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
            ' ' + msid;
        if (transceiver.sendEncodingParameters[0].rtx) {
          sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
              ' ' + msid;
          sdp += 'a=ssrc-group:FID ' +
              transceiver.sendEncodingParameters[0].ssrc + ' ' +
              transceiver.sendEncodingParameters[0].rtx.ssrc +
              '\r\n';
        }
      }
      // FIXME: this should be written by writeRtpDescription.
      sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
          ' cname:' + SDPUtils.localCName + '\r\n';
      if (transceiver.rtpSender && transceiver.sendEncodingParameters[0].rtx) {
        sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
            ' cname:' + SDPUtils.localCName + '\r\n';
      }
      return sdp;
    };
    
    // Gets the direction from the mediaSection or the sessionpart.
    SDPUtils.getDirection = function(mediaSection, sessionpart) {
      // Look for sendrecv, sendonly, recvonly, inactive, default to sendrecv.
      var lines = SDPUtils.splitLines(mediaSection);
      for (var i = 0; i < lines.length; i++) {
        switch (lines[i]) {
          case 'a=sendrecv':
          case 'a=sendonly':
          case 'a=recvonly':
          case 'a=inactive':
            return lines[i].substr(2);
          default:
            // FIXME: What should happen here?
        }
      }
      if (sessionpart) {
        return SDPUtils.getDirection(sessionpart);
      }
      return 'sendrecv';
    };
    
    SDPUtils.getKind = function(mediaSection) {
      var lines = SDPUtils.splitLines(mediaSection);
      var mline = lines[0].split(' ');
      return mline[0].substr(2);
    };
    
    SDPUtils.isRejected = function(mediaSection) {
      return mediaSection.split(' ', 2)[1] === '0';
    };
    
    SDPUtils.parseMLine = function(mediaSection) {
      var lines = SDPUtils.splitLines(mediaSection);
      var parts = lines[0].substr(2).split(' ');
      return {
        kind: parts[0],
        port: parseInt(parts[1], 10),
        protocol: parts[2],
        fmt: parts.slice(3).join(' ')
      };
    };
    
    SDPUtils.parseOLine = function(mediaSection) {
      var line = SDPUtils.matchPrefix(mediaSection, 'o=')[0];
      var parts = line.substr(2).split(' ');
      return {
        username: parts[0],
        sessionId: parts[1],
        sessionVersion: parseInt(parts[2], 10),
        netType: parts[3],
        addressType: parts[4],
        address: parts[5]
      };
    };
    
    // a very naive interpretation of a valid SDP.
    SDPUtils.isValidSDP = function(blob) {
      if (typeof blob !== 'string' || blob.length === 0) {
        return false;
      }
      var lines = SDPUtils.splitLines(blob);
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].length < 2 || lines[i].charAt(1) !== '=') {
          return false;
        }
        // TODO: check the modifier a bit more.
      }
      return true;
    };
    
    // Expose public methods.
    if (typeof module === 'object') {
      module.exports = SDPUtils;
    }
    
    },{}],3:[function(require,module,exports){
    (function (global){
    /*
     *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
     *
     *  Use of this source code is governed by a BSD-style license
     *  that can be found in the LICENSE file in the root of the source
     *  tree.
     */
     /* eslint-env node */
    
    'use strict';
    
    var adapterFactory = require('./adapter_factory.js');
    module.exports = adapterFactory({window: global.window});
    
    }).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
    },{"./adapter_factory.js":4}],4:[function(require,module,exports){
    /*
     *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
     *
     *  Use of this source code is governed by a BSD-style license
     *  that can be found in the LICENSE file in the root of the source
     *  tree.
     */
     /* eslint-env node */
    
    'use strict';
    
    var utils = require('./utils');
    // Shimming starts here.
    module.exports = function(dependencies, opts) {
      var window = dependencies && dependencies.window;
    
      var options = {
        shimChrome: true,
        shimFirefox: true,
        shimEdge: true,
        shimSafari: true,
      };
    
      for (var key in opts) {
        if (hasOwnProperty.call(opts, key)) {
          options[key] = opts[key];
        }
      }
    
      // Utils.
      var logging = utils.log;
      var browserDetails = utils.detectBrowser(window);
    
      // Uncomment the line below if you want logging to occur, including logging
      // for the switch statement below. Can also be turned on in the browser via
      // adapter.disableLog(false), but then logging from the switch statement below
      // will not appear.
      // require('./utils').disableLog(false);
    
      // Browser shims.
      var chromeShim = require('./chrome/chrome_shim') || null;
      var edgeShim = require('./edge/edge_shim') || null;
      var firefoxShim = require('./firefox/firefox_shim') || null;
      var safariShim = require('./safari/safari_shim') || null;
      var commonShim = require('./common_shim') || null;
    
      // Export to the adapter global object visible in the browser.
      var adapter = {
        browserDetails: browserDetails,
        commonShim: commonShim,
        extractVersion: utils.extractVersion,
        disableLog: utils.disableLog,
        disableWarnings: utils.disableWarnings
      };
    
      // Shim browser if found.
      switch (browserDetails.browser) {
        case 'chrome':
          if (!chromeShim || !chromeShim.shimPeerConnection ||
              !options.shimChrome) {
            logging('Chrome shim is not included in this adapter release.');
            return adapter;
          }
          logging('adapter.js shimming chrome.');
          // Export to the adapter global object visible in the browser.
          adapter.browserShim = chromeShim;
          commonShim.shimCreateObjectURL(window);
    
          chromeShim.shimGetUserMedia(window);
          chromeShim.shimMediaStream(window);
          chromeShim.shimSourceObject(window);
          chromeShim.shimPeerConnection(window);
          chromeShim.shimOnTrack(window);
          chromeShim.shimAddTrackRemoveTrack(window);
          chromeShim.shimGetSendersWithDtmf(window);
          chromeShim.shimSenderReceiverGetStats(window);
          chromeShim.fixNegotiationNeeded(window);
    
          commonShim.shimRTCIceCandidate(window);
          commonShim.shimMaxMessageSize(window);
          commonShim.shimSendThrowTypeError(window);
          break;
        case 'firefox':
          if (!firefoxShim || !firefoxShim.shimPeerConnection ||
              !options.shimFirefox) {
            logging('Firefox shim is not included in this adapter release.');
            return adapter;
          }
          logging('adapter.js shimming firefox.');
          // Export to the adapter global object visible in the browser.
          adapter.browserShim = firefoxShim;
          commonShim.shimCreateObjectURL(window);
    
          firefoxShim.shimGetUserMedia(window);
          firefoxShim.shimSourceObject(window);
          firefoxShim.shimPeerConnection(window);
          firefoxShim.shimOnTrack(window);
          firefoxShim.shimRemoveStream(window);
          firefoxShim.shimSenderGetStats(window);
          firefoxShim.shimReceiverGetStats(window);
          firefoxShim.shimRTCDataChannel(window);
    
          commonShim.shimRTCIceCandidate(window);
          commonShim.shimMaxMessageSize(window);
          commonShim.shimSendThrowTypeError(window);
          break;
        case 'edge':
          if (!edgeShim || !edgeShim.shimPeerConnection || !options.shimEdge) {
            logging('MS edge shim is not included in this adapter release.');
            return adapter;
          }
          logging('adapter.js shimming edge.');
          // Export to the adapter global object visible in the browser.
          adapter.browserShim = edgeShim;
          commonShim.shimCreateObjectURL(window);
    
          edgeShim.shimGetUserMedia(window);
          edgeShim.shimPeerConnection(window);
          edgeShim.shimReplaceTrack(window);
    
          // the edge shim implements the full RTCIceCandidate object.
    
          commonShim.shimMaxMessageSize(window);
          commonShim.shimSendThrowTypeError(window);
          break;
        case 'safari':
          if (!safariShim || !options.shimSafari) {
            logging('Safari shim is not included in this adapter release.');
            return adapter;
          }
          logging('adapter.js shimming safari.');
          // Export to the adapter global object visible in the browser.
          adapter.browserShim = safariShim;
          commonShim.shimCreateObjectURL(window);
    
          safariShim.shimRTCIceServerUrls(window);
          safariShim.shimCreateOfferLegacy(window);
          safariShim.shimCallbacksAPI(window);
          safariShim.shimLocalStreamsAPI(window);
          safariShim.shimRemoteStreamsAPI(window);
          safariShim.shimTrackEventTransceiver(window);
          safariShim.shimGetUserMedia(window);
    
          commonShim.shimRTCIceCandidate(window);
          commonShim.shimMaxMessageSize(window);
          commonShim.shimSendThrowTypeError(window);
          break;
        default:
          logging('Unsupported browser!');
          break;
      }
    
      return adapter;
    };
    
    },{"./chrome/chrome_shim":5,"./common_shim":7,"./edge/edge_shim":8,"./firefox/firefox_shim":11,"./safari/safari_shim":13,"./utils":14}],5:[function(require,module,exports){
    
    /*
     *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
     *
     *  Use of this source code is governed by a BSD-style license
     *  that can be found in the LICENSE file in the root of the source
     *  tree.
     */
     /* eslint-env node */
    'use strict';
    var utils = require('../utils.js');
    var logging = utils.log;
    
    /* iterates the stats graph recursively. */
    function walkStats(stats, base, resultSet) {
      if (!base || resultSet.has(base.id)) {
        return;
      }
      resultSet.set(base.id, base);
      Object.keys(base).forEach(function(name) {
        if (name.endsWith('Id')) {
          walkStats(stats, stats.get(base[name]), resultSet);
        } else if (name.endsWith('Ids')) {
          base[name].forEach(function(id) {
            walkStats(stats, stats.get(id), resultSet);
          });
        }
      });
    }
    
    /* filter getStats for a sender/receiver track. */
    function filterStats(result, track, outbound) {
      var streamStatsType = outbound ? 'outbound-rtp' : 'inbound-rtp';
      var filteredResult = new Map();
      if (track === null) {
        return filteredResult;
      }
      var trackStats = [];
      result.forEach(function(value) {
        if (value.type === 'track' &&
            value.trackIdentifier === track.id) {
          trackStats.push(value);
        }
      });
      trackStats.forEach(function(trackStat) {
        result.forEach(function(stats) {
          if (stats.type === streamStatsType && stats.trackId === trackStat.id) {
            walkStats(result, stats, filteredResult);
          }
        });
      });
      return filteredResult;
    }
    
    module.exports = {
      shimGetUserMedia: require('./getusermedia'),
      shimMediaStream: function(window) {
        window.MediaStream = window.MediaStream || window.webkitMediaStream;
      },
    
      shimOnTrack: function(window) {
        if (typeof window === 'object' && window.RTCPeerConnection && !('ontrack' in
            window.RTCPeerConnection.prototype)) {
          Object.defineProperty(window.RTCPeerConnection.prototype, 'ontrack', {
            get: function() {
              return this._ontrack;
            },
            set: function(f) {
              if (this._ontrack) {
                this.removeEventListener('track', this._ontrack);
              }
              this.addEventListener('track', this._ontrack = f);
            },
            enumerable: true,
            configurable: true
          });
          var origSetRemoteDescription =
              window.RTCPeerConnection.prototype.setRemoteDescription;
          window.RTCPeerConnection.prototype.setRemoteDescription = function() {
            var pc = this;
            if (!pc._ontrackpoly) {
              pc._ontrackpoly = function(e) {
                // onaddstream does not fire when a track is added to an existing
                // stream. But stream.onaddtrack is implemented so we use that.
                e.stream.addEventListener('addtrack', function(te) {
                  var receiver;
                  if (window.RTCPeerConnection.prototype.getReceivers) {
                    receiver = pc.getReceivers().find(function(r) {
                      return r.track && r.track.id === te.track.id;
                    });
                  } else {
                    receiver = {track: te.track};
                  }
    
                  var event = new Event('track');
                  event.track = te.track;
                  event.receiver = receiver;
                  event.transceiver = {receiver: receiver};
                  event.streams = [e.stream];
                  pc.dispatchEvent(event);
                });
                e.stream.getTracks().forEach(function(track) {
                  var receiver;
                  if (window.RTCPeerConnection.prototype.getReceivers) {
                    receiver = pc.getReceivers().find(function(r) {
                      return r.track && r.track.id === track.id;
                    });
                  } else {
                    receiver = {track: track};
                  }
                  var event = new Event('track');
                  event.track = track;
                  event.receiver = receiver;
                  event.transceiver = {receiver: receiver};
                  event.streams = [e.stream];
                  pc.dispatchEvent(event);
                });
              };
              pc.addEventListener('addstream', pc._ontrackpoly);
            }
            return origSetRemoteDescription.apply(pc, arguments);
          };
        } else {
          // even if RTCRtpTransceiver is in window, it is only used and
          // emitted in unified-plan. Unfortunately this means we need
          // to unconditionally wrap the event.
          utils.wrapPeerConnectionEvent(window, 'track', function(e) {
            if (!e.transceiver) {
              Object.defineProperty(e, 'transceiver',
                {value: {receiver: e.receiver}});
            }
            return e;
          });
        }
      },
    
      shimGetSendersWithDtmf: function(window) {
        // Overrides addTrack/removeTrack, depends on shimAddTrackRemoveTrack.
        if (typeof window === 'object' && window.RTCPeerConnection &&
            !('getSenders' in window.RTCPeerConnection.prototype) &&
            'createDTMFSender' in window.RTCPeerConnection.prototype) {
          var shimSenderWithDtmf = function(pc, track) {
            return {
              track: track,
              get dtmf() {
                if (this._dtmf === undefined) {
                  if (track.kind === 'audio') {
                    this._dtmf = pc.createDTMFSender(track);
                  } else {
                    this._dtmf = null;
                  }
                }
                return this._dtmf;
              },
              _pc: pc
            };
          };
    
          // augment addTrack when getSenders is not available.
          if (!window.RTCPeerConnection.prototype.getSenders) {
            window.RTCPeerConnection.prototype.getSenders = function() {
              this._senders = this._senders || [];
              return this._senders.slice(); // return a copy of the internal state.
            };
            var origAddTrack = window.RTCPeerConnection.prototype.addTrack;
            window.RTCPeerConnection.prototype.addTrack = function(track, stream) {
              var pc = this;
              var sender = origAddTrack.apply(pc, arguments);
              if (!sender) {
                sender = shimSenderWithDtmf(pc, track);
                pc._senders.push(sender);
              }
              return sender;
            };
    
            var origRemoveTrack = window.RTCPeerConnection.prototype.removeTrack;
            window.RTCPeerConnection.prototype.removeTrack = function(sender) {
              var pc = this;
              origRemoveTrack.apply(pc, arguments);
              var idx = pc._senders.indexOf(sender);
              if (idx !== -1) {
                pc._senders.splice(idx, 1);
              }
            };
          }
          var origAddStream = window.RTCPeerConnection.prototype.addStream;
          window.RTCPeerConnection.prototype.addStream = function(stream) {
            var pc = this;
            pc._senders = pc._senders || [];
            origAddStream.apply(pc, [stream]);
            stream.getTracks().forEach(function(track) {
              pc._senders.push(shimSenderWithDtmf(pc, track));
            });
          };
    
          var origRemoveStream = window.RTCPeerConnection.prototype.removeStream;
          window.RTCPeerConnection.prototype.removeStream = function(stream) {
            var pc = this;
            pc._senders = pc._senders || [];
            origRemoveStream.apply(pc, [stream]);
    
            stream.getTracks().forEach(function(track) {
              var sender = pc._senders.find(function(s) {
                return s.track === track;
              });
              if (sender) {
                pc._senders.splice(pc._senders.indexOf(sender), 1); // remove sender
              }
            });
          };
        } else if (typeof window === 'object' && window.RTCPeerConnection &&
                   'getSenders' in window.RTCPeerConnection.prototype &&
                   'createDTMFSender' in window.RTCPeerConnection.prototype &&
                   window.RTCRtpSender &&
                   !('dtmf' in window.RTCRtpSender.prototype)) {
          var origGetSenders = window.RTCPeerConnection.prototype.getSenders;
          window.RTCPeerConnection.prototype.getSenders = function() {
            var pc = this;
            var senders = origGetSenders.apply(pc, []);
            senders.forEach(function(sender) {
              sender._pc = pc;
            });
            return senders;
          };
    
          Object.defineProperty(window.RTCRtpSender.prototype, 'dtmf', {
            get: function() {
              if (this._dtmf === undefined) {
                if (this.track.kind === 'audio') {
                  this._dtmf = this._pc.createDTMFSender(this.track);
                } else {
                  this._dtmf = null;
                }
              }
              return this._dtmf;
            }
          });
        }
      },
    
      shimSenderReceiverGetStats: function(window) {
        if (!(typeof window === 'object' && window.RTCPeerConnection &&
            window.RTCRtpSender && window.RTCRtpReceiver)) {
          return;
        }
    
        // shim sender stats.
        if (!('getStats' in window.RTCRtpSender.prototype)) {
          var origGetSenders = window.RTCPeerConnection.prototype.getSenders;
          if (origGetSenders) {
            window.RTCPeerConnection.prototype.getSenders = function() {
              var pc = this;
              var senders = origGetSenders.apply(pc, []);
              senders.forEach(function(sender) {
                sender._pc = pc;
              });
              return senders;
            };
          }
    
          var origAddTrack = window.RTCPeerConnection.prototype.addTrack;
          if (origAddTrack) {
            window.RTCPeerConnection.prototype.addTrack = function() {
              var sender = origAddTrack.apply(this, arguments);
              sender._pc = this;
              return sender;
            };
          }
          window.RTCRtpSender.prototype.getStats = function() {
            var sender = this;
            return this._pc.getStats().then(function(result) {
              /* Note: this will include stats of all senders that
               *   send a track with the same id as sender.track as
               *   it is not possible to identify the RTCRtpSender.
               */
              return filterStats(result, sender.track, true);
            });
          };
        }
    
        // shim receiver stats.
        if (!('getStats' in window.RTCRtpReceiver.prototype)) {
          var origGetReceivers = window.RTCPeerConnection.prototype.getReceivers;
          if (origGetReceivers) {
            window.RTCPeerConnection.prototype.getReceivers = function() {
              var pc = this;
              var receivers = origGetReceivers.apply(pc, []);
              receivers.forEach(function(receiver) {
                receiver._pc = pc;
              });
              return receivers;
            };
          }
          utils.wrapPeerConnectionEvent(window, 'track', function(e) {
            e.receiver._pc = e.srcElement;
            return e;
          });
          window.RTCRtpReceiver.prototype.getStats = function() {
            var receiver = this;
            return this._pc.getStats().then(function(result) {
              return filterStats(result, receiver.track, false);
            });
          };
        }
    
        if (!('getStats' in window.RTCRtpSender.prototype &&
            'getStats' in window.RTCRtpReceiver.prototype)) {
          return;
        }
    
        // shim RTCPeerConnection.getStats(track).
        var origGetStats = window.RTCPeerConnection.prototype.getStats;
        window.RTCPeerConnection.prototype.getStats = function() {
          var pc = this;
          if (arguments.length > 0 &&
              arguments[0] instanceof window.MediaStreamTrack) {
            var track = arguments[0];
            var sender;
            var receiver;
            var err;
            pc.getSenders().forEach(function(s) {
              if (s.track === track) {
                if (sender) {
                  err = true;
                } else {
                  sender = s;
                }
              }
            });
            pc.getReceivers().forEach(function(r) {
              if (r.track === track) {
                if (receiver) {
                  err = true;
                } else {
                  receiver = r;
                }
              }
              return r.track === track;
            });
            if (err || (sender && receiver)) {
              return Promise.reject(new DOMException(
                'There are more than one sender or receiver for the track.',
                'InvalidAccessError'));
            } else if (sender) {
              return sender.getStats();
            } else if (receiver) {
              return receiver.getStats();
            }
            return Promise.reject(new DOMException(
              'There is no sender or receiver for the track.',
              'InvalidAccessError'));
          }
          return origGetStats.apply(pc, arguments);
        };
      },
    
      shimSourceObject: function(window) {
        var URL = window && window.URL;
    
        if (typeof window === 'object') {
          if (window.HTMLMediaElement &&
            !('srcObject' in window.HTMLMediaElement.prototype)) {
            // Shim the srcObject property, once, when HTMLMediaElement is found.
            Object.defineProperty(window.HTMLMediaElement.prototype, 'srcObject', {
              get: function() {
                return this._srcObject;
              },
              set: function(stream) {
                var self = this;
                // Use _srcObject as a private property for this shim
                this._srcObject = stream;
                if (this.src) {
                  URL.revokeObjectURL(this.src);
                }
    
                if (!stream) {
                  this.src = '';
                  return undefined;
                }
                this.src = URL.createObjectURL(stream);
                // We need to recreate the blob url when a track is added or
                // removed. Doing it manually since we want to avoid a recursion.
                stream.addEventListener('addtrack', function() {
                  if (self.src) {
                    URL.revokeObjectURL(self.src);
                  }
                  self.src = URL.createObjectURL(stream);
                });
                stream.addEventListener('removetrack', function() {
                  if (self.src) {
                    URL.revokeObjectURL(self.src);
                  }
                  self.src = URL.createObjectURL(stream);
                });
              }
            });
          }
        }
      },
    
      shimAddTrackRemoveTrackWithNative: function(window) {
        // shim addTrack/removeTrack with native variants in order to make
        // the interactions with legacy getLocalStreams behave as in other browsers.
        // Keeps a mapping stream.id => [stream, rtpsenders...]
        window.RTCPeerConnection.prototype.getLocalStreams = function() {
          var pc = this;
          this._shimmedLocalStreams = this._shimmedLocalStreams || {};
          return Object.keys(this._shimmedLocalStreams).map(function(streamId) {
            return pc._shimmedLocalStreams[streamId][0];
          });
        };
    
        var origAddTrack = window.RTCPeerConnection.prototype.addTrack;
        window.RTCPeerConnection.prototype.addTrack = function(track, stream) {
          if (!stream) {
            return origAddTrack.apply(this, arguments);
          }
          this._shimmedLocalStreams = this._shimmedLocalStreams || {};
    
          var sender = origAddTrack.apply(this, arguments);
          if (!this._shimmedLocalStreams[stream.id]) {
            this._shimmedLocalStreams[stream.id] = [stream, sender];
          } else if (this._shimmedLocalStreams[stream.id].indexOf(sender) === -1) {
            this._shimmedLocalStreams[stream.id].push(sender);
          }
          return sender;
        };
    
        var origAddStream = window.RTCPeerConnection.prototype.addStream;
        window.RTCPeerConnection.prototype.addStream = function(stream) {
          var pc = this;
          this._shimmedLocalStreams = this._shimmedLocalStreams || {};
    
          stream.getTracks().forEach(function(track) {
            var alreadyExists = pc.getSenders().find(function(s) {
              return s.track === track;
            });
            if (alreadyExists) {
              throw new DOMException('Track already exists.',
                  'InvalidAccessError');
            }
          });
          var existingSenders = pc.getSenders();
          origAddStream.apply(this, arguments);
          var newSenders = pc.getSenders().filter(function(newSender) {
            return existingSenders.indexOf(newSender) === -1;
          });
          this._shimmedLocalStreams[stream.id] = [stream].concat(newSenders);
        };
    
        var origRemoveStream = window.RTCPeerConnection.prototype.removeStream;
        window.RTCPeerConnection.prototype.removeStream = function(stream) {
          this._shimmedLocalStreams = this._shimmedLocalStreams || {};
          delete this._shimmedLocalStreams[stream.id];
          return origRemoveStream.apply(this, arguments);
        };
    
        var origRemoveTrack = window.RTCPeerConnection.prototype.removeTrack;
        window.RTCPeerConnection.prototype.removeTrack = function(sender) {
          var pc = this;
          this._shimmedLocalStreams = this._shimmedLocalStreams || {};
          if (sender) {
            Object.keys(this._shimmedLocalStreams).forEach(function(streamId) {
              var idx = pc._shimmedLocalStreams[streamId].indexOf(sender);
              if (idx !== -1) {
                pc._shimmedLocalStreams[streamId].splice(idx, 1);
              }
              if (pc._shimmedLocalStreams[streamId].length === 1) {
                delete pc._shimmedLocalStreams[streamId];
              }
            });
          }
          return origRemoveTrack.apply(this, arguments);
        };
      },
    
      shimAddTrackRemoveTrack: function(window) {
        var browserDetails = utils.detectBrowser(window);
        // shim addTrack and removeTrack.
        if (window.RTCPeerConnection.prototype.addTrack &&
            browserDetails.version >= 65) {
          return this.shimAddTrackRemoveTrackWithNative(window);
        }
    
        // also shim pc.getLocalStreams when addTrack is shimmed
        // to return the original streams.
        var origGetLocalStreams = window.RTCPeerConnection.prototype
            .getLocalStreams;
        window.RTCPeerConnection.prototype.getLocalStreams = function() {
          var pc = this;
          var nativeStreams = origGetLocalStreams.apply(this);
          pc._reverseStreams = pc._reverseStreams || {};
          return nativeStreams.map(function(stream) {
            return pc._reverseStreams[stream.id];
          });
        };
    
        var origAddStream = window.RTCPeerConnection.prototype.addStream;
        window.RTCPeerConnection.prototype.addStream = function(stream) {
          var pc = this;
          pc._streams = pc._streams || {};
          pc._reverseStreams = pc._reverseStreams || {};
    
          stream.getTracks().forEach(function(track) {
            var alreadyExists = pc.getSenders().find(function(s) {
              return s.track === track;
            });
            if (alreadyExists) {
              throw new DOMException('Track already exists.',
                  'InvalidAccessError');
            }
          });
          // Add identity mapping for consistency with addTrack.
          // Unless this is being used with a stream from addTrack.
          if (!pc._reverseStreams[stream.id]) {
            var newStream = new window.MediaStream(stream.getTracks());
            pc._streams[stream.id] = newStream;
            pc._reverseStreams[newStream.id] = stream;
            stream = newStream;
          }
          origAddStream.apply(pc, [stream]);
        };
    
        var origRemoveStream = window.RTCPeerConnection.prototype.removeStream;
        window.RTCPeerConnection.prototype.removeStream = function(stream) {
          var pc = this;
          pc._streams = pc._streams || {};
          pc._reverseStreams = pc._reverseStreams || {};
    
          origRemoveStream.apply(pc, [(pc._streams[stream.id] || stream)]);
          delete pc._reverseStreams[(pc._streams[stream.id] ?
              pc._streams[stream.id].id : stream.id)];
          delete pc._streams[stream.id];
        };
    
        window.RTCPeerConnection.prototype.addTrack = function(track, stream) {
          var pc = this;
          if (pc.signalingState === 'closed') {
            throw new DOMException(
              'The RTCPeerConnection\'s signalingState is \'closed\'.',
              'InvalidStateError');
          }
          var streams = [].slice.call(arguments, 1);
          if (streams.length !== 1 ||
              !streams[0].getTracks().find(function(t) {
                return t === track;
              })) {
            // this is not fully correct but all we can manage without
            // [[associated MediaStreams]] internal slot.
            throw new DOMException(
              'The adapter.js addTrack polyfill only supports a single ' +
              ' stream which is associated with the specified track.',
              'NotSupportedError');
          }
    
          var alreadyExists = pc.getSenders().find(function(s) {
            return s.track === track;
          });
          if (alreadyExists) {
            throw new DOMException('Track already exists.',
                'InvalidAccessError');
          }
    
          pc._streams = pc._streams || {};
          pc._reverseStreams = pc._reverseStreams || {};
          var oldStream = pc._streams[stream.id];
          if (oldStream) {
            // this is using odd Chrome behaviour, use with caution:
            // https://bugs.chromium.org/p/webrtc/issues/detail?id=7815
            // Note: we rely on the high-level addTrack/dtmf shim to
            // create the sender with a dtmf sender.
            oldStream.addTrack(track);
    
            // Trigger ONN async.
            Promise.resolve().then(function() {
              pc.dispatchEvent(new Event('negotiationneeded'));
            });
          } else {
            var newStream = new window.MediaStream([track]);
            pc._streams[stream.id] = newStream;
            pc._reverseStreams[newStream.id] = stream;
            pc.addStream(newStream);
          }
          return pc.getSenders().find(function(s) {
            return s.track === track;
          });
        };
    
        // replace the internal stream id with the external one and
        // vice versa.
        function replaceInternalStreamId(pc, description) {
          var sdp = description.sdp;
          Object.keys(pc._reverseStreams || []).forEach(function(internalId) {
            var externalStream = pc._reverseStreams[internalId];
            var internalStream = pc._streams[externalStream.id];
            sdp = sdp.replace(new RegExp(internalStream.id, 'g'),
                externalStream.id);
          });
          return new RTCSessionDescription({
            type: description.type,
            sdp: sdp
          });
        }
        function replaceExternalStreamId(pc, description) {
          var sdp = description.sdp;
          Object.keys(pc._reverseStreams || []).forEach(function(internalId) {
            var externalStream = pc._reverseStreams[internalId];
            var internalStream = pc._streams[externalStream.id];
            sdp = sdp.replace(new RegExp(externalStream.id, 'g'),
                internalStream.id);
          });
          return new RTCSessionDescription({
            type: description.type,
            sdp: sdp
          });
        }
        ['createOffer', 'createAnswer'].forEach(function(method) {
          var nativeMethod = window.RTCPeerConnection.prototype[method];
          window.RTCPeerConnection.prototype[method] = function() {
            var pc = this;
            var args = arguments;
            var isLegacyCall = arguments.length &&
                typeof arguments[0] === 'function';
            if (isLegacyCall) {
              return nativeMethod.apply(pc, [
                function(description) {
                  var desc = replaceInternalStreamId(pc, description);
                  args[0].apply(null, [desc]);
                },
                function(err) {
                  if (args[1]) {
                    args[1].apply(null, err);
                  }
                }, arguments[2]
              ]);
            }
            return nativeMethod.apply(pc, arguments)
            .then(function(description) {
              return replaceInternalStreamId(pc, description);
            });
          };
        });
    
        var origSetLocalDescription =
            window.RTCPeerConnection.prototype.setLocalDescription;
        window.RTCPeerConnection.prototype.setLocalDescription = function() {
          var pc = this;
          if (!arguments.length || !arguments[0].type) {
            return origSetLocalDescription.apply(pc, arguments);
          }
          arguments[0] = replaceExternalStreamId(pc, arguments[0]);
          return origSetLocalDescription.apply(pc, arguments);
        };
    
        // TODO: mangle getStats: https://w3c.github.io/webrtc-stats/#dom-rtcmediastreamstats-streamidentifier
    
        var origLocalDescription = Object.getOwnPropertyDescriptor(
            window.RTCPeerConnection.prototype, 'localDescription');
        Object.defineProperty(window.RTCPeerConnection.prototype,
            'localDescription', {
              get: function() {
                var pc = this;
                var description = origLocalDescription.get.apply(this);
                if (description.type === '') {
                  return description;
                }
                return replaceInternalStreamId(pc, description);
              }
            });
    
        window.RTCPeerConnection.prototype.removeTrack = function(sender) {
          var pc = this;
          if (pc.signalingState === 'closed') {
            throw new DOMException(
              'The RTCPeerConnection\'s signalingState is \'closed\'.',
              'InvalidStateError');
          }
          // We can not yet check for sender instanceof RTCRtpSender
          // since we shim RTPSender. So we check if sender._pc is set.
          if (!sender._pc) {
            throw new DOMException('Argument 1 of RTCPeerConnection.removeTrack ' +
                'does not implement interface RTCRtpSender.', 'TypeError');
          }
          var isLocal = sender._pc === pc;
          if (!isLocal) {
            throw new DOMException('Sender was not created by this connection.',
                'InvalidAccessError');
          }
    
          // Search for the native stream the senders track belongs to.
          pc._streams = pc._streams || {};
          var stream;
          Object.keys(pc._streams).forEach(function(streamid) {
            var hasTrack = pc._streams[streamid].getTracks().find(function(track) {
              return sender.track === track;
            });
            if (hasTrack) {
              stream = pc._streams[streamid];
            }
          });
    
          if (stream) {
            if (stream.getTracks().length === 1) {
              // if this is the last track of the stream, remove the stream. This
              // takes care of any shimmed _senders.
              pc.removeStream(pc._reverseStreams[stream.id]);
            } else {
              // relying on the same odd chrome behaviour as above.
              stream.removeTrack(sender.track);
            }
            pc.dispatchEvent(new Event('negotiationneeded'));
          }
        };
      },
    
      shimPeerConnection: function(window) {
        var browserDetails = utils.detectBrowser(window);
    
        // The RTCPeerConnection object.
        if (!window.RTCPeerConnection && window.webkitRTCPeerConnection) {
          window.RTCPeerConnection = function(pcConfig, pcConstraints) {
            // Translate iceTransportPolicy to iceTransports,
            // see https://code.google.com/p/webrtc/issues/detail?id=4869
            // this was fixed in M56 along with unprefixing RTCPeerConnection.
            logging('PeerConnection');
            if (pcConfig && pcConfig.iceTransportPolicy) {
              pcConfig.iceTransports = pcConfig.iceTransportPolicy;
            }
    
            return new window.webkitRTCPeerConnection(pcConfig, pcConstraints);
          };
          window.RTCPeerConnection.prototype =
              window.webkitRTCPeerConnection.prototype;
          // wrap static methods. Currently just generateCertificate.
          if (window.webkitRTCPeerConnection.generateCertificate) {
            Object.defineProperty(window.RTCPeerConnection, 'generateCertificate', {
              get: function() {
                return window.webkitRTCPeerConnection.generateCertificate;
              }
            });
          }
        }
    
        var origGetStats = window.RTCPeerConnection.prototype.getStats;
        window.RTCPeerConnection.prototype.getStats = function(selector,
            successCallback, errorCallback) {
          var pc = this;
          var args = arguments;
    
          // If selector is a function then we are in the old style stats so just
          // pass back the original getStats format to avoid breaking old users.
          if (arguments.length > 0 && typeof selector === 'function') {
            return origGetStats.apply(this, arguments);
          }
    
          // When spec-style getStats is supported, return those when called with
          // either no arguments or the selector argument is null.
          if (origGetStats.length === 0 && (arguments.length === 0 ||
              typeof arguments[0] !== 'function')) {
            return origGetStats.apply(this, []);
          }
    
          var fixChromeStats_ = function(response) {
            var standardReport = {};
            var reports = response.result();
            reports.forEach(function(report) {
              var standardStats = {
                id: report.id,
                timestamp: report.timestamp,
                type: {
                  localcandidate: 'local-candidate',
                  remotecandidate: 'remote-candidate'
                }[report.type] || report.type
              };
              report.names().forEach(function(name) {
                standardStats[name] = report.stat(name);
              });
              standardReport[standardStats.id] = standardStats;
            });
    
            return standardReport;
          };
    
          // shim getStats with maplike support
          var makeMapStats = function(stats) {
            return new Map(Object.keys(stats).map(function(key) {
              return [key, stats[key]];
            }));
          };
    
          if (arguments.length >= 2) {
            var successCallbackWrapper_ = function(response) {
              args[1](makeMapStats(fixChromeStats_(response)));
            };
    
            return origGetStats.apply(this, [successCallbackWrapper_,
              arguments[0]]);
          }
    
          // promise-support
          return new Promise(function(resolve, reject) {
            origGetStats.apply(pc, [
              function(response) {
                resolve(makeMapStats(fixChromeStats_(response)));
              }, reject]);
          }).then(successCallback, errorCallback);
        };
    
        // add promise support -- natively available in Chrome 51
        if (browserDetails.version < 51) {
          ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate']
              .forEach(function(method) {
                var nativeMethod = window.RTCPeerConnection.prototype[method];
                window.RTCPeerConnection.prototype[method] = function() {
                  var args = arguments;
                  var pc = this;
                  var promise = new Promise(function(resolve, reject) {
                    nativeMethod.apply(pc, [args[0], resolve, reject]);
                  });
                  if (args.length < 2) {
                    return promise;
                  }
                  return promise.then(function() {
                    args[1].apply(null, []);
                  },
                  function(err) {
                    if (args.length >= 3) {
                      args[2].apply(null, [err]);
                    }
                  });
                };
              });
        }
    
        // promise support for createOffer and createAnswer. Available (without
        // bugs) since M52: crbug/619289
        if (browserDetails.version < 52) {
          ['createOffer', 'createAnswer'].forEach(function(method) {
            var nativeMethod = window.RTCPeerConnection.prototype[method];
            window.RTCPeerConnection.prototype[method] = function() {
              var pc = this;
              if (arguments.length < 1 || (arguments.length === 1 &&
                  typeof arguments[0] === 'object')) {
                var opts = arguments.length === 1 ? arguments[0] : undefined;
                return new Promise(function(resolve, reject) {
                  nativeMethod.apply(pc, [resolve, reject, opts]);
                });
              }
              return nativeMethod.apply(this, arguments);
            };
          });
        }
    
        // shim implicit creation of RTCSessionDescription/RTCIceCandidate
        ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate']
            .forEach(function(method) {
              var nativeMethod = window.RTCPeerConnection.prototype[method];
              window.RTCPeerConnection.prototype[method] = function() {
                arguments[0] = new ((method === 'addIceCandidate') ?
                    window.RTCIceCandidate :
                    window.RTCSessionDescription)(arguments[0]);
                return nativeMethod.apply(this, arguments);
              };
            });
    
        // support for addIceCandidate(null or undefined)
        var nativeAddIceCandidate =
            window.RTCPeerConnection.prototype.addIceCandidate;
        window.RTCPeerConnection.prototype.addIceCandidate = function() {
          if (!arguments[0]) {
            if (arguments[1]) {
              arguments[1].apply(null);
            }
            return Promise.resolve();
          }
          return nativeAddIceCandidate.apply(this, arguments);
        };
      },
    
      fixNegotiationNeeded: function(window) {
        utils.wrapPeerConnectionEvent(window, 'negotiationneeded', function(e) {
          var pc = e.target;
          if (pc.signalingState !== 'stable') {
            return;
          }
          return e;
        });
      },
    
      shimGetDisplayMedia: function(window, getSourceId) {
        if ('getDisplayMedia' in window.navigator) {
          return;
        }
        // getSourceId is a function that returns a promise resolving with
        // the sourceId of the screen/window/tab to be shared.
        if (typeof getSourceId !== 'function') {
          console.error('shimGetDisplayMedia: getSourceId argument is not ' +
              'a function');
          return;
        }
        navigator.getDisplayMedia = function(constraints) {
          return getSourceId(constraints)
            .then(function(sourceId) {
              constraints.video = {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId,
                  maxFrameRate: constraints.video.frameRate || 3
                }
              };
              return navigator.mediaDevices.getUserMedia(constraints);
            });
        };
      }
    };
    
    },{"../utils.js":14,"./getusermedia":6}],6:[function(require,module,exports){
    /*
     *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
     *
     *  Use of this source code is governed by a BSD-style license
     *  that can be found in the LICENSE file in the root of the source
     *  tree.
     */
     /* eslint-env node */
    'use strict';
    var utils = require('../utils.js');
    var logging = utils.log;
    
    // Expose public methods.
    module.exports = function(window) {
      var browserDetails = utils.detectBrowser(window);
      var navigator = window && window.navigator;
    
      var constraintsToChrome_ = function(c) {
        if (typeof c !== 'object' || c.mandatory || c.optional) {
          return c;
        }
        var cc = {};
        Object.keys(c).forEach(function(key) {
          if (key === 'require' || key === 'advanced' || key === 'mediaSource') {
            return;
          }
          var r = (typeof c[key] === 'object') ? c[key] : {ideal: c[key]};
          if (r.exact !== undefined && typeof r.exact === 'number') {
            r.min = r.max = r.exact;
          }
          var oldname_ = function(prefix, name) {
            if (prefix) {
              return prefix + name.charAt(0).toUpperCase() + name.slice(1);
            }
            return (name === 'deviceId') ? 'sourceId' : name;
          };
          if (r.ideal !== undefined) {
            cc.optional = cc.optional || [];
            var oc = {};
            if (typeof r.ideal === 'number') {
              oc[oldname_('min', key)] = r.ideal;
              cc.optional.push(oc);
              oc = {};
              oc[oldname_('max', key)] = r.ideal;
              cc.optional.push(oc);
            } else {
              oc[oldname_('', key)] = r.ideal;
              cc.optional.push(oc);
            }
          }
          if (r.exact !== undefined && typeof r.exact !== 'number') {
            cc.mandatory = cc.mandatory || {};
            cc.mandatory[oldname_('', key)] = r.exact;
          } else {
            ['min', 'max'].forEach(function(mix) {
              if (r[mix] !== undefined) {
                cc.mandatory = cc.mandatory || {};
                cc.mandatory[oldname_(mix, key)] = r[mix];
              }
            });
          }
        });
        if (c.advanced) {
          cc.optional = (cc.optional || []).concat(c.advanced);
        }
        return cc;
      };
    
      var shimConstraints_ = function(constraints, func) {
        if (browserDetails.version >= 61) {
          return func(constraints);
        }
        constraints = JSON.parse(JSON.stringify(constraints));
        if (constraints && typeof constraints.audio === 'object') {
          var remap = function(obj, a, b) {
            if (a in obj && !(b in obj)) {
              obj[b] = obj[a];
              delete obj[a];
            }
          };
          constraints = JSON.parse(JSON.stringify(constraints));
          remap(constraints.audio, 'autoGainControl', 'googAutoGainControl');
          remap(constraints.audio, 'noiseSuppression', 'googNoiseSuppression');
          constraints.audio = constraintsToChrome_(constraints.audio);
        }
        if (constraints && typeof constraints.video === 'object') {
          // Shim facingMode for mobile & surface pro.
          var face = constraints.video.facingMode;
          face = face && ((typeof face === 'object') ? face : {ideal: face});
          var getSupportedFacingModeLies = browserDetails.version < 66;
    
          if ((face && (face.exact === 'user' || face.exact === 'environment' ||
                        face.ideal === 'user' || face.ideal === 'environment')) &&
              !(navigator.mediaDevices.getSupportedConstraints &&
                navigator.mediaDevices.getSupportedConstraints().facingMode &&
                !getSupportedFacingModeLies)) {
            delete constraints.video.facingMode;
            var matches;
            if (face.exact === 'environment' || face.ideal === 'environment') {
              matches = ['back', 'rear'];
            } else if (face.exact === 'user' || face.ideal === 'user') {
              matches = ['front'];
            }
            if (matches) {
              // Look for matches in label, or use last cam for back (typical).
              return navigator.mediaDevices.enumerateDevices()
              .then(function(devices) {
                devices = devices.filter(function(d) {
                  return d.kind === 'videoinput';
                });
                var dev = devices.find(function(d) {
                  return matches.some(function(match) {
                    return d.label.toLowerCase().indexOf(match) !== -1;
                  });
                });
                if (!dev && devices.length && matches.indexOf('back') !== -1) {
                  dev = devices[devices.length - 1]; // more likely the back cam
                }
                if (dev) {
                  constraints.video.deviceId = face.exact ? {exact: dev.deviceId} :
                                                            {ideal: dev.deviceId};
                }
                constraints.video = constraintsToChrome_(constraints.video);
                logging('chrome: ' + JSON.stringify(constraints));
                return func(constraints);
              });
            }
          }
          constraints.video = constraintsToChrome_(constraints.video);
        }
        logging('chrome: ' + JSON.stringify(constraints));
        return func(constraints);
      };
    
      var shimError_ = function(e) {
        if (browserDetails.version >= 64) {
          return e;
        }
        return {
          name: {
            PermissionDeniedError: 'NotAllowedError',
            PermissionDismissedError: 'NotAllowedError',
            InvalidStateError: 'NotAllowedError',
            DevicesNotFoundError: 'NotFoundError',
            ConstraintNotSatisfiedError: 'OverconstrainedError',
            TrackStartError: 'NotReadableError',
            MediaDeviceFailedDueToShutdown: 'NotAllowedError',
            MediaDeviceKillSwitchOn: 'NotAllowedError',
            TabCaptureError: 'AbortError',
            ScreenCaptureError: 'AbortError',
            DeviceCaptureError: 'AbortError'
          }[e.name] || e.name,
          message: e.message,
          constraint: e.constraint || e.constraintName,
          toString: function() {
            return this.name + (this.message && ': ') + this.message;
          }
        };
      };
    
      var getUserMedia_ = function(constraints, onSuccess, onError) {
        shimConstraints_(constraints, function(c) {
          navigator.webkitGetUserMedia(c, onSuccess, function(e) {
            if (onError) {
              onError(shimError_(e));
            }
          });
        });
      };
    
      navigator.getUserMedia = getUserMedia_;
    
      // Returns the result of getUserMedia as a Promise.
      var getUserMediaPromise_ = function(constraints) {
        return new Promise(function(resolve, reject) {
          navigator.getUserMedia(constraints, resolve, reject);
        });
      };
    
      if (!navigator.mediaDevices) {
        navigator.mediaDevices = {
          getUserMedia: getUserMediaPromise_,
          enumerateDevices: function() {
            return new Promise(function(resolve) {
              var kinds = {audio: 'audioinput', video: 'videoinput'};
              return window.MediaStreamTrack.getSources(function(devices) {
                resolve(devices.map(function(device) {
                  return {label: device.label,
                    kind: kinds[device.kind],
                    deviceId: device.id,
                    groupId: ''};
                }));
              });
            });
          },
          getSupportedConstraints: function() {
            return {
              deviceId: true, echoCancellation: true, facingMode: true,
              frameRate: true, height: true, width: true
            };
          }
        };
      }
    
      // A shim for getUserMedia method on the mediaDevices object.
      // TODO(KaptenJansson) remove once implemented in Chrome stable.
      if (!navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia = function(constraints) {
          return getUserMediaPromise_(constraints);
        };
      } else {
        // Even though Chrome 45 has navigator.mediaDevices and a getUserMedia
        // function which returns a Promise, it does not accept spec-style
        // constraints.
        var origGetUserMedia = navigator.mediaDevices.getUserMedia.
            bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = function(cs) {
          return shimConstraints_(cs, function(c) {
            return origGetUserMedia(c).then(function(stream) {
              if (c.audio && !stream.getAudioTracks().length ||
                  c.video && !stream.getVideoTracks().length) {
                stream.getTracks().forEach(function(track) {
                  track.stop();
                });
                throw new DOMException('', 'NotFoundError');
              }
              return stream;
            }, function(e) {
              return Promise.reject(shimError_(e));
            });
          });
        };
      }
    
      // Dummy devicechange event methods.
      // TODO(KaptenJansson) remove once implemented in Chrome stable.
      if (typeof navigator.mediaDevices.addEventListener === 'undefined') {
        navigator.mediaDevices.addEventListener = function() {
          logging('Dummy mediaDevices.addEventListener called.');
        };
      }
      if (typeof navigator.mediaDevices.removeEventListener === 'undefined') {
        navigator.mediaDevices.removeEventListener = function() {
          logging('Dummy mediaDevices.removeEventListener called.');
        };
      }
    };
    
    },{"../utils.js":14}],7:[function(require,module,exports){
    /*
     *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
     *
     *  Use of this source code is governed by a BSD-style license
     *  that can be found in the LICENSE file in the root of the source
     *  tree.
     */
     /* eslint-env node */
    'use strict';
    
    var SDPUtils = require('sdp');
    var utils = require('./utils');
    
    module.exports = {
      shimRTCIceCandidate: function(window) {
        // foundation is arbitrarily chosen as an indicator for full support for
        // https://w3c.github.io/webrtc-pc/#rtcicecandidate-interface
        if (!window.RTCIceCandidate || (window.RTCIceCandidate && 'foundation' in
            window.RTCIceCandidate.prototype)) {
          return;
        }
    
        var NativeRTCIceCandidate = window.RTCIceCandidate;
        window.RTCIceCandidate = function(args) {
          // Remove the a= which shouldn't be part of the candidate string.
          if (typeof args === 'object' && args.candidate &&
              args.candidate.indexOf('a=') === 0) {
            args = JSON.parse(JSON.stringify(args));
            args.candidate = args.candidate.substr(2);
          }
    
          if (args.candidate && args.candidate.length) {
            // Augment the native candidate with the parsed fields.
            var nativeCandidate = new NativeRTCIceCandidate(args);
            var parsedCandidate = SDPUtils.parseCandidate(args.candidate);
            var augmentedCandidate = Object.assign(nativeCandidate,
                parsedCandidate);
    
            // Add a serializer that does not serialize the extra attributes.
            augmentedCandidate.toJSON = function() {
              return {
                candidate: augmentedCandidate.candidate,
                sdpMid: augmentedCandidate.sdpMid,
                sdpMLineIndex: augmentedCandidate.sdpMLineIndex,
                usernameFragment: augmentedCandidate.usernameFragment,
              };
            };
            return augmentedCandidate;
          }
          return new NativeRTCIceCandidate(args);
        };
        window.RTCIceCandidate.prototype = NativeRTCIceCandidate.prototype;
    
        // Hook up the augmented candidate in onicecandidate and
        // addEventListener('icecandidate', ...)
        utils.wrapPeerConnectionEvent(window, 'icecandidate', function(e) {
          if (e.candidate) {
            Object.defineProperty(e, 'candidate', {
              value: new window.RTCIceCandidate(e.candidate),
              writable: 'false'
            });
          }
          return e;
        });
      },
    
      // shimCreateObjectURL must be called before shimSourceObject to avoid loop.
    
      shimCreateObjectURL: function(window) {
        var URL = window && window.URL;
    
        if (!(typeof window === 'object' && window.HTMLMediaElement &&
              'srcObject' in window.HTMLMediaElement.prototype &&
            URL.createObjectURL && URL.revokeObjectURL)) {
          // Only shim CreateObjectURL using srcObject if srcObject exists.
          return undefined;
        }
    
        var nativeCreateObjectURL = URL.createObjectURL.bind(URL);
        var nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
        var streams = new Map(), newId = 0;
    
        URL.createObjectURL = function(stream) {
          if ('getTracks' in stream) {
            var url = 'polyblob:' + (++newId);
            streams.set(url, stream);
            utils.deprecated('URL.createObjectURL(stream)',
                'elem.srcObject = stream');
            return url;
          }
          return nativeCreateObjectURL(stream);
        };
        URL.revokeObjectURL = function(url) {
          nativeRevokeObjectURL(url);
          streams.delete(url);
        };
    
        var dsc = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype,
                                                  'src');
        Object.defineProperty(window.HTMLMediaElement.prototype, 'src', {
          get: function() {
            return dsc.get.apply(this);
          },
          set: function(url) {
            this.srcObject = streams.get(url) || null;
            return dsc.set.apply(this, [url]);
          }
        });
    
        var nativeSetAttribute = window.HTMLMediaElement.prototype.setAttribute;
        window.HTMLMediaElement.prototype.setAttribute = function() {
          if (arguments.length === 2 &&
              ('' + arguments[0]).toLowerCase() === 'src') {
            this.srcObject = streams.get(arguments[1]) || null;
          }
          return nativeSetAttribute.apply(this, arguments);
        };
      },
    
      shimMaxMessageSize: function(window) {
        if (window.RTCSctpTransport || !window.RTCPeerConnection) {
          return;
        }
        var browserDetails = utils.detectBrowser(window);
    
        if (!('sctp' in window.RTCPeerConnection.prototype)) {
          Object.defineProperty(window.RTCPeerConnection.prototype, 'sctp', {
            get: function() {
              return typeof this._sctp === 'undefined' ? null : this._sctp;
            }
          });
        }
    
        var sctpInDescription = function(description) {
          var sections = SDPUtils.splitSections(description.sdp);
          sections.shift();
          return sections.some(function(mediaSection) {
            var mLine = SDPUtils.parseMLine(mediaSection);
            return mLine && mLine.kind === 'application'
                && mLine.protocol.indexOf('SCTP') !== -1;
          });
        };
    
        var getRemoteFirefoxVersion = function(description) {
          // TODO: Is there a better solution for detecting Firefox?
          var match = description.sdp.match(/mozilla...THIS_IS_SDPARTA-(\d+)/);
          if (match === null || match.length < 2) {
            return -1;
          }
          var version = parseInt(match[1], 10);
          // Test for NaN (yes, this is ugly)
          return version !== version ? -1 : version;
        };
    
        var getCanSendMaxMessageSize = function(remoteIsFirefox) {
          // Every implementation we know can send at least 64 KiB.
          // Note: Although Chrome is technically able to send up to 256 KiB, the
          //       data does not reach the other peer reliably.
          //       See: https://bugs.chromium.org/p/webrtc/issues/detail?id=8419
          var canSendMaxMessageSize = 65536;
          if (browserDetails.browser === 'firefox') {
            if (browserDetails.version < 57) {
              if (remoteIsFirefox === -1) {
                // FF < 57 will send in 16 KiB chunks using the deprecated PPID
                // fragmentation.
                canSendMaxMessageSize = 16384;
              } else {
                // However, other FF (and RAWRTC) can reassemble PPID-fragmented
                // messages. Thus, supporting ~2 GiB when sending.
                canSendMaxMessageSize = 2147483637;
              }
            } else if (browserDetails.version < 60) {
              // Currently, all FF >= 57 will reset the remote maximum message size
              // to the default value when a data channel is created at a later
              // stage. :(
              // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1426831
              canSendMaxMessageSize =
                browserDetails.version === 57 ? 65535 : 65536;
            } else {
              // FF >= 60 supports sending ~2 GiB
              canSendMaxMessageSize = 2147483637;
            }
          }
          return canSendMaxMessageSize;
        };
    
        var getMaxMessageSize = function(description, remoteIsFirefox) {
          // Note: 65536 bytes is the default value from the SDP spec. Also,
          //       every implementation we know supports receiving 65536 bytes.
          var maxMessageSize = 65536;
    
          // FF 57 has a slightly incorrect default remote max message size, so
          // we need to adjust it here to avoid a failure when sending.
          // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1425697
          if (browserDetails.browser === 'firefox'
               && browserDetails.version === 57) {
            maxMessageSize = 65535;
          }
    
          var match = SDPUtils.matchPrefix(description.sdp, 'a=max-message-size:');
          if (match.length > 0) {
            maxMessageSize = parseInt(match[0].substr(19), 10);
          } else if (browserDetails.browser === 'firefox' &&
                      remoteIsFirefox !== -1) {
            // If the maximum message size is not present in the remote SDP and
            // both local and remote are Firefox, the remote peer can receive
            // ~2 GiB.
            maxMessageSize = 2147483637;
          }
          return maxMessageSize;
        };
    
        var origSetRemoteDescription =
            window.RTCPeerConnection.prototype.setRemoteDescription;
        window.RTCPeerConnection.prototype.setRemoteDescription = function() {
          var pc = this;
          pc._sctp = null;
    
          if (sctpInDescription(arguments[0])) {
            // Check if the remote is FF.
            var isFirefox = getRemoteFirefoxVersion(arguments[0]);
    
            // Get the maximum message size the local peer is capable of sending
            var canSendMMS = getCanSendMaxMessageSize(isFirefox);
    
            // Get the maximum message size of the remote peer.
            var remoteMMS = getMaxMessageSize(arguments[0], isFirefox);
    
            // Determine final maximum message size
            var maxMessageSize;
            if (canSendMMS === 0 && remoteMMS === 0) {
              maxMessageSize = Number.POSITIVE_INFINITY;
            } else if (canSendMMS === 0 || remoteMMS === 0) {
              maxMessageSize = Math.max(canSendMMS, remoteMMS);
            } else {
              maxMessageSize = Math.min(canSendMMS, remoteMMS);
            }
    
            // Create a dummy RTCSctpTransport object and the 'maxMessageSize'
            // attribute.
            var sctp = {};
            Object.defineProperty(sctp, 'maxMessageSize', {
              get: function() {
                return maxMessageSize;
              }
            });
            pc._sctp = sctp;
          }
    
          return origSetRemoteDescription.apply(pc, arguments);
        };
      },
    
      shimSendThrowTypeError: function(window) {
        if (!(window.RTCPeerConnection &&
            'createDataChannel' in window.RTCPeerConnection.prototype)) {
          return;
        }
    
        // Note: Although Firefox >= 57 has a native implementation, the maximum
        //       message size can be reset for all data channels at a later stage.
        //       See: https://bugzilla.mozilla.org/show_bug.cgi?id=1426831
    
        function wrapDcSend(dc, pc) {
          var origDataChannelSend = dc.send;
          dc.send = function() {
            var data = arguments[0];
            var length = data.length || data.size || data.byteLength;
            if (dc.readyState === 'open' &&
                pc.sctp && length > pc.sctp.maxMessageSize) {
              throw new TypeError('Message too large (can send a maximum of ' +
                pc.sctp.maxMessageSize + ' bytes)');
            }
            return origDataChannelSend.apply(dc, arguments);
          };
        }
        var origCreateDataChannel =
          window.RTCPeerConnection.prototype.createDataChannel;
        window.RTCPeerConnection.prototype.createDataChannel = function() {
          var pc = this;
          var dataChannel = origCreateDataChannel.apply(pc, arguments);
          wrapDcSend(dataChannel, pc);
          return dataChannel;
        };
        utils.wrapPeerConnectionEvent(window, 'datachannel', function(e) {
          wrapDcSend(e.channel, e.target);
          return e;
        });
      }
    };
    
    },{"./utils":14,"sdp":2}],8:[function(require,module,exports){
    /*
     *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
     *
     *  Use of this source code is governed by a BSD-style license
     *  that can be found in the LICENSE file in the root of the source
     *  tree.
     */
     /* eslint-env node */
    'use strict';
    
    var utils = require('../utils');
    var filterIceServers = require('./filtericeservers');
    var shimRTCPeerConnection = require('rtcpeerconnection-shim');
    
    module.exports = {
      shimGetUserMedia: require('./getusermedia'),
      shimPeerConnection: function(window) {
        var browserDetails = utils.detectBrowser(window);
    
        if (window.RTCIceGatherer) {
          if (!window.RTCIceCandidate) {
            window.RTCIceCandidate = function(args) {
              return args;
            };
          }
          if (!window.RTCSessionDescription) {
            window.RTCSessionDescription = function(args) {
              return args;
            };
          }
          // this adds an additional event listener to MediaStrackTrack that signals
          // when a tracks enabled property was changed. Workaround for a bug in
          // addStream, see below. No longer required in 15025+
          if (browserDetails.version < 15025) {
            var origMSTEnabled = Object.getOwnPropertyDescriptor(
                window.MediaStreamTrack.prototype, 'enabled');
            Object.defineProperty(window.MediaStreamTrack.prototype, 'enabled', {
              set: function(value) {
                origMSTEnabled.set.call(this, value);
                var ev = new Event('enabled');
                ev.enabled = value;
                this.dispatchEvent(ev);
              }
            });
          }
        }
    
        // ORTC defines the DTMF sender a bit different.
        // https://github.com/w3c/ortc/issues/714
        if (window.RTCRtpSender && !('dtmf' in window.RTCRtpSender.prototype)) {
          Object.defineProperty(window.RTCRtpSender.prototype, 'dtmf', {
            get: function() {
              if (this._dtmf === undefined) {
                if (this.track.kind === 'audio') {
                  this._dtmf = new window.RTCDtmfSender(this);
                } else if (this.track.kind === 'video') {
                  this._dtmf = null;
                }
              }
              return this._dtmf;
            }
          });
        }
        // Edge currently only implements the RTCDtmfSender, not the
        // RTCDTMFSender alias. See http://draft.ortc.org/#rtcdtmfsender2*
        if (window.RTCDtmfSender && !window.RTCDTMFSender) {
          window.RTCDTMFSender = window.RTCDtmfSender;
        }
    
        var RTCPeerConnectionShim = shimRTCPeerConnection(window,
            browserDetails.version);
        window.RTCPeerConnection = function(config) {
          if (config && config.iceServers) {
            config.iceServers = filterIceServers(config.iceServers);
          }
          return new RTCPeerConnectionShim(config);
        };
        window.RTCPeerConnection.prototype = RTCPeerConnectionShim.prototype;
      },
      shimReplaceTrack: function(window) {
        // ORTC has replaceTrack -- https://github.com/w3c/ortc/issues/614
        if (window.RTCRtpSender &&
            !('replaceTrack' in window.RTCRtpSender.prototype)) {
          window.RTCRtpSender.prototype.replaceTrack =
              window.RTCRtpSender.prototype.setTrack;
        }
      }
    };
    
    },{"../utils":14,"./filtericeservers":9,"./getusermedia":10,"rtcpeerconnection-shim":1}],9:[function(require,module,exports){
    /*
     *  Copyright (c) 2018 The WebRTC project authors. All Rights Reserved.
     *
     *  Use of this source code is governed by a BSD-style license
     *  that can be found in the LICENSE file in the root of the source
     *  tree.
     */
     /* eslint-env node */
    'use strict';
    
    var utils = require('../utils');
    // Edge does not like
    // 1) stun: filtered after 14393 unless ?transport=udp is present
    // 2) turn: that does not have all of turn:host:port?transport=udp
    // 3) turn: with ipv6 addresses
    // 4) turn: occurring muliple times
    module.exports = function(iceServers, edgeVersion) {
      var hasTurn = false;
      iceServers = JSON.parse(JSON.stringify(iceServers));
      return iceServers.filter(function(server) {
        if (server && (server.urls || server.url)) {
          var urls = server.urls || server.url;
          if (server.url && !server.urls) {
            utils.deprecated('RTCIceServer.url', 'RTCIceServer.urls');
          }
          var isString = typeof urls === 'string';
          if (isString) {
            urls = [urls];
          }
          urls = urls.filter(function(url) {
            var validTurn = url.indexOf('turn:') === 0 &&
                url.indexOf('transport=udp') !== -1 &&
                url.indexOf('turn:[') === -1 &&
                !hasTurn;
    
            if (validTurn) {
              hasTurn = true;
              return true;
            }
            return url.indexOf('stun:') === 0 && edgeVersion >= 14393 &&
                url.indexOf('?transport=udp') === -1;
          });
    
          delete server.url;
          server.urls = isString ? urls[0] : urls;
          return !!urls.length;
        }
      });
    };
    
    },{"../utils":14}],10:[function(require,module,exports){
    /*
     *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
     *
     *  Use of this source code is governed by a BSD-style license
     *  that can be found in the LICENSE file in the root of the source
     *  tree.
     */
     /* eslint-env node */
    'use strict';
    
    // Expose public methods.
    module.exports = function(window) {
      var navigator = window && window.navigator;
    
      var shimError_ = function(e) {
        return {
          name: {PermissionDeniedError: 'NotAllowedError'}[e.name] || e.name,
          message: e.message,
          constraint: e.constraint,
          toString: function() {
            return this.name;
          }
        };
      };
    
      // getUserMedia error shim.
      var origGetUserMedia = navigator.mediaDevices.getUserMedia.
          bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = function(c) {
        return origGetUserMedia(c).catch(function(e) {
          return Promise.reject(shimError_(e));
        });
      };
    };
    
    },{}],11:[function(require,module,exports){
    /*
     *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
     *
     *  Use of this source code is governed by a BSD-style license
     *  that can be found in the LICENSE file in the root of the source
     *  tree.
     */
     /* eslint-env node */
    'use strict';
    
    var utils = require('../utils');
    
    module.exports = {
      shimGetUserMedia: require('./getusermedia'),
      shimOnTrack: function(window) {
        if (typeof window === 'object' && window.RTCPeerConnection && !('ontrack' in
            window.RTCPeerConnection.prototype)) {
          Object.defineProperty(window.RTCPeerConnection.prototype, 'ontrack', {
            get: function() {
              return this._ontrack;
            },
            set: function(f) {
              if (this._ontrack) {
                this.removeEventListener('track', this._ontrack);
                this.removeEventListener('addstream', this._ontrackpoly);
              }
              this.addEventListener('track', this._ontrack = f);
              this.addEventListener('addstream', this._ontrackpoly = function(e) {
                e.stream.getTracks().forEach(function(track) {
                  var event = new Event('track');
                  event.track = track;
                  event.receiver = {track: track};
                  event.transceiver = {receiver: event.receiver};
                  event.streams = [e.stream];
                  this.dispatchEvent(event);
                }.bind(this));
              }.bind(this));
            },
            enumerable: true,
            configurable: true
          });
        }
        if (typeof window === 'object' && window.RTCTrackEvent &&
            ('receiver' in window.RTCTrackEvent.prototype) &&
            !('transceiver' in window.RTCTrackEvent.prototype)) {
          Object.defineProperty(window.RTCTrackEvent.prototype, 'transceiver', {
            get: function() {
              return {receiver: this.receiver};
            }
          });
        }
      },
    
      shimSourceObject: function(window) {
        // Firefox has supported mozSrcObject since FF22, unprefixed in 42.
        if (typeof window === 'object') {
          if (window.HTMLMediaElement &&
            !('srcObject' in window.HTMLMediaElement.prototype)) {
            // Shim the srcObject property, once, when HTMLMediaElement is found.
            Object.defineProperty(window.HTMLMediaElement.prototype, 'srcObject', {
              get: function() {
                return this.mozSrcObject;
              },
              set: function(stream) {
                this.mozSrcObject = stream;
              }
            });
          }
        }
      },
    
      shimPeerConnection: function(window) {
        var browserDetails = utils.detectBrowser(window);
    
        if (typeof window !== 'object' || !(window.RTCPeerConnection ||
            window.mozRTCPeerConnection)) {
          return; // probably media.peerconnection.enabled=false in about:config
        }
        // The RTCPeerConnection object.
        if (!window.RTCPeerConnection) {
          window.RTCPeerConnection = function(pcConfig, pcConstraints) {
            if (browserDetails.version < 38) {
              // .urls is not supported in FF < 38.
              // create RTCIceServers with a single url.
              if (pcConfig && pcConfig.iceServers) {
                var newIceServers = [];
                for (var i = 0; i < pcConfig.iceServers.length; i++) {
                  var server = pcConfig.iceServers[i];
                  if (server.hasOwnProperty('urls')) {
                    for (var j = 0; j < server.urls.length; j++) {
                      var newServer = {
                        url: server.urls[j]
                      };
                      if (server.urls[j].indexOf('turn') === 0) {
                        newServer.username = server.username;
                        newServer.credential = server.credential;
                      }
                      newIceServers.push(newServer);
                    }
                  } else {
                    newIceServers.push(pcConfig.iceServers[i]);
                  }
                }
                pcConfig.iceServers = newIceServers;
              }
            }
            return new window.mozRTCPeerConnection(pcConfig, pcConstraints);
          };
          window.RTCPeerConnection.prototype =
              window.mozRTCPeerConnection.prototype;
    
          // wrap static methods. Currently just generateCertificate.
          if (window.mozRTCPeerConnection.generateCertificate) {
            Object.defineProperty(window.RTCPeerConnection, 'generateCertificate', {
              get: function() {
                return window.mozRTCPeerConnection.generateCertificate;
              }
            });
          }
    
          window.RTCSessionDescription = window.mozRTCSessionDescription;
          window.RTCIceCandidate = window.mozRTCIceCandidate;
        }
    
        // shim away need for obsolete RTCIceCandidate/RTCSessionDescription.
        ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate']
            .forEach(function(method) {
              var nativeMethod = window.RTCPeerConnection.prototype[method];
              window.RTCPeerConnection.prototype[method] = function() {
                arguments[0] = new ((method === 'addIceCandidate') ?
                    window.RTCIceCandidate :
                    window.RTCSessionDescription)(arguments[0]);
                return nativeMethod.apply(this, arguments);
              };
            });
    
        // support for addIceCandidate(null or undefined)
        var nativeAddIceCandidate =
            window.RTCPeerConnection.prototype.addIceCandidate;
        window.RTCPeerConnection.prototype.addIceCandidate = function() {
          if (!arguments[0]) {
            if (arguments[1]) {
              arguments[1].apply(null);
            }
            return Promise.resolve();
          }
          return nativeAddIceCandidate.apply(this, arguments);
        };
    
        // shim getStats with maplike support
        var makeMapStats = function(stats) {
          var map = new Map();
          Object.keys(stats).forEach(function(key) {
            map.set(key, stats[key]);
            map[key] = stats[key];
          });
          return map;
        };
    
        var modernStatsTypes = {
          inboundrtp: 'inbound-rtp',
          outboundrtp: 'outbound-rtp',
          candidatepair: 'candidate-pair',
          localcandidate: 'local-candidate',
          remotecandidate: 'remote-candidate'
        };
    
        var nativeGetStats = window.RTCPeerConnection.prototype.getStats;
        window.RTCPeerConnection.prototype.getStats = function(
          selector,
          onSucc,
          onErr
        ) {
          return nativeGetStats.apply(this, [selector || null])
            .then(function(stats) {
              if (browserDetails.version < 48) {
                stats = makeMapStats(stats);
              }
              if (browserDetails.version < 53 && !onSucc) {
                // Shim only promise getStats with spec-hyphens in type names
                // Leave callback version alone; misc old uses of forEach before Map
                try {
                  stats.forEach(function(stat) {
                    stat.type = modernStatsTypes[stat.type] || stat.type;
                  });
                } catch (e) {
                  if (e.name !== 'TypeError') {
                    throw e;
                  }
                  // Avoid TypeError: "type" is read-only, in old versions. 34-43ish
                  stats.forEach(function(stat, i) {
                    stats.set(i, Object.assign({}, stat, {
                      type: modernStatsTypes[stat.type] || stat.type
                    }));
                  });
                }
              }
              return stats;
            })
            .then(onSucc, onErr);
        };
      },
    
      shimSenderGetStats: function(window) {
        if (!(typeof window === 'object' && window.RTCPeerConnection &&
            window.RTCRtpSender)) {
          return;
        }
        if (window.RTCRtpSender && 'getStats' in window.RTCRtpSender.prototype) {
          return;
        }
        var origGetSenders = window.RTCPeerConnection.prototype.getSenders;
        if (origGetSenders) {
          window.RTCPeerConnection.prototype.getSenders = function() {
            var pc = this;
            var senders = origGetSenders.apply(pc, []);
            senders.forEach(function(sender) {
              sender._pc = pc;
            });
            return senders;
          };
        }
    
        var origAddTrack = window.RTCPeerConnection.prototype.addTrack;
        if (origAddTrack) {
          window.RTCPeerConnection.prototype.addTrack = function() {
            var sender = origAddTrack.apply(this, arguments);
            sender._pc = this;
            return sender;
          };
        }
        window.RTCRtpSender.prototype.getStats = function() {
          return this.track ? this._pc.getStats(this.track) :
              Promise.resolve(new Map());
        };
      },
    
      shimReceiverGetStats: function(window) {
        if (!(typeof window === 'object' && window.RTCPeerConnection &&
            window.RTCRtpSender)) {
          return;
        }
        if (window.RTCRtpSender && 'getStats' in window.RTCRtpReceiver.prototype) {
          return;
        }
        var origGetReceivers = window.RTCPeerConnection.prototype.getReceivers;
        if (origGetReceivers) {
          window.RTCPeerConnection.prototype.getReceivers = function() {
            var pc = this;
            var receivers = origGetReceivers.apply(pc, []);
            receivers.forEach(function(receiver) {
              receiver._pc = pc;
            });
            return receivers;
          };
        }
        utils.wrapPeerConnectionEvent(window, 'track', function(e) {
          e.receiver._pc = e.srcElement;
          return e;
        });
        window.RTCRtpReceiver.prototype.getStats = function() {
          return this._pc.getStats(this.track);
        };
      },
    
      shimRemoveStream: function(window) {
        if (!window.RTCPeerConnection ||
            'removeStream' in window.RTCPeerConnection.prototype) {
          return;
        }
        window.RTCPeerConnection.prototype.removeStream = function(stream) {
          var pc = this;
          utils.deprecated('removeStream', 'removeTrack');
          this.getSenders().forEach(function(sender) {
            if (sender.track && stream.getTracks().indexOf(sender.track) !== -1) {
              pc.removeTrack(sender);
            }
          });
        };
      },
    
      shimRTCDataChannel: function(window) {
        // rename DataChannel to RTCDataChannel (native fix in FF60):
        // https://bugzilla.mozilla.org/show_bug.cgi?id=1173851
        if (window.DataChannel && !window.RTCDataChannel) {
          window.RTCDataChannel = window.DataChannel;
        }
      },
    
      shimGetDisplayMedia: function(window, preferredMediaSource) {
        if ('getDisplayMedia' in window.navigator) {
          return;
        }
        navigator.getDisplayMedia = function(constraints) {
          if (!(constraints && constraints.video)) {
            var err = new DOMException('getDisplayMedia without video ' +
                'constraints is undefined');
            err.name = 'NotFoundError';
            // from https://heycam.github.io/webidl/#idl-DOMException-error-names
            err.code = 8;
            return Promise.reject(err);
          }
          if (constraints.video === true) {
            constraints.video = {mediaSource: preferredMediaSource};
          } else {
            constraints.video.mediaSource = preferredMediaSource;
          }
          return navigator.mediaDevices.getUserMedia(constraints);
        };
      }
    };
    
    },{"../utils":14,"./getusermedia":12}],12:[function(require,module,exports){
    /*
     *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
     *
     *  Use of this source code is governed by a BSD-style license
     *  that can be found in the LICENSE file in the root of the source
     *  tree.
     */
     /* eslint-env node */
    'use strict';
    
    var utils = require('../utils');
    var logging = utils.log;
    
    // Expose public methods.
    module.exports = function(window) {
      var browserDetails = utils.detectBrowser(window);
      var navigator = window && window.navigator;
      var MediaStreamTrack = window && window.MediaStreamTrack;
    
      var shimError_ = function(e) {
        return {
          name: {
            InternalError: 'NotReadableError',
            NotSupportedError: 'TypeError',
            PermissionDeniedError: 'NotAllowedError',
            SecurityError: 'NotAllowedError'
          }[e.name] || e.name,
          message: {
            'The operation is insecure.': 'The request is not allowed by the ' +
            'user agent or the platform in the current context.'
          }[e.message] || e.message,
          constraint: e.constraint,
          toString: function() {
            return this.name + (this.message && ': ') + this.message;
          }
        };
      };
    
      // getUserMedia constraints shim.
      var getUserMedia_ = function(constraints, onSuccess, onError) {
        var constraintsToFF37_ = function(c) {
          if (typeof c !== 'object' || c.require) {
            return c;
          }
          var require = [];
          Object.keys(c).forEach(function(key) {
            if (key === 'require' || key === 'advanced' || key === 'mediaSource') {
              return;
            }
            var r = c[key] = (typeof c[key] === 'object') ?
                c[key] : {ideal: c[key]};
            if (r.min !== undefined ||
                r.max !== undefined || r.exact !== undefined) {
              require.push(key);
            }
            if (r.exact !== undefined) {
              if (typeof r.exact === 'number') {
                r. min = r.max = r.exact;
              } else {
                c[key] = r.exact;
              }
              delete r.exact;
            }
            if (r.ideal !== undefined) {
              c.advanced = c.advanced || [];
              var oc = {};
              if (typeof r.ideal === 'number') {
                oc[key] = {min: r.ideal, max: r.ideal};
              } else {
                oc[key] = r.ideal;
              }
              c.advanced.push(oc);
              delete r.ideal;
              if (!Object.keys(r).length) {
                delete c[key];
              }
            }
          });
          if (require.length) {
            c.require = require;
          }
          return c;
        };
        constraints = JSON.parse(JSON.stringify(constraints));
        if (browserDetails.version < 38) {
          logging('spec: ' + JSON.stringify(constraints));
          if (constraints.audio) {
            constraints.audio = constraintsToFF37_(constraints.audio);
          }
          if (constraints.video) {
            constraints.video = constraintsToFF37_(constraints.video);
          }
          logging('ff37: ' + JSON.stringify(constraints));
        }
        return navigator.mozGetUserMedia(constraints, onSuccess, function(e) {
          onError(shimError_(e));
        });
      };
    
      // Returns the result of getUserMedia as a Promise.
      var getUserMediaPromise_ = function(constraints) {
        return new Promise(function(resolve, reject) {
          getUserMedia_(constraints, resolve, reject);
        });
      };
    
      // Shim for mediaDevices on older versions.
      if (!navigator.mediaDevices) {
        navigator.mediaDevices = {getUserMedia: getUserMediaPromise_,
          addEventListener: function() { },
          removeEventListener: function() { }
        };
      }
      navigator.mediaDevices.enumerateDevices =
          navigator.mediaDevices.enumerateDevices || function() {
            return new Promise(function(resolve) {
              var infos = [
                {kind: 'audioinput', deviceId: 'default', label: '', groupId: ''},
                {kind: 'videoinput', deviceId: 'default', label: '', groupId: ''}
              ];
              resolve(infos);
            });
          };
    
      if (browserDetails.version < 41) {
        // Work around http://bugzil.la/1169665
        var orgEnumerateDevices =
            navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
        navigator.mediaDevices.enumerateDevices = function() {
          return orgEnumerateDevices().then(undefined, function(e) {
            if (e.name === 'NotFoundError') {
              return [];
            }
            throw e;
          });
        };
      }
      if (browserDetails.version < 49) {
        var origGetUserMedia = navigator.mediaDevices.getUserMedia.
            bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = function(c) {
          return origGetUserMedia(c).then(function(stream) {
            // Work around https://bugzil.la/802326
            if (c.audio && !stream.getAudioTracks().length ||
                c.video && !stream.getVideoTracks().length) {
              stream.getTracks().forEach(function(track) {
                track.stop();
              });
              throw new DOMException('The object can not be found here.',
                                     'NotFoundError');
            }
            return stream;
          }, function(e) {
            return Promise.reject(shimError_(e));
          });
        };
      }
      if (!(browserDetails.version > 55 &&
          'autoGainControl' in navigator.mediaDevices.getSupportedConstraints())) {
        var remap = function(obj, a, b) {
          if (a in obj && !(b in obj)) {
            obj[b] = obj[a];
            delete obj[a];
          }
        };
    
        var nativeGetUserMedia = navigator.mediaDevices.getUserMedia.
            bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = function(c) {
          if (typeof c === 'object' && typeof c.audio === 'object') {
            c = JSON.parse(JSON.stringify(c));
            remap(c.audio, 'autoGainControl', 'mozAutoGainControl');
            remap(c.audio, 'noiseSuppression', 'mozNoiseSuppression');
          }
          return nativeGetUserMedia(c);
        };
    
        if (MediaStreamTrack && MediaStreamTrack.prototype.getSettings) {
          var nativeGetSettings = MediaStreamTrack.prototype.getSettings;
          MediaStreamTrack.prototype.getSettings = function() {
            var obj = nativeGetSettings.apply(this, arguments);
            remap(obj, 'mozAutoGainControl', 'autoGainControl');
            remap(obj, 'mozNoiseSuppression', 'noiseSuppression');
            return obj;
          };
        }
    
        if (MediaStreamTrack && MediaStreamTrack.prototype.applyConstraints) {
          var nativeApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
          MediaStreamTrack.prototype.applyConstraints = function(c) {
            if (this.kind === 'audio' && typeof c === 'object') {
              c = JSON.parse(JSON.stringify(c));
              remap(c, 'autoGainControl', 'mozAutoGainControl');
              remap(c, 'noiseSuppression', 'mozNoiseSuppression');
            }
            return nativeApplyConstraints.apply(this, [c]);
          };
        }
      }
      navigator.getUserMedia = function(constraints, onSuccess, onError) {
        if (browserDetails.version < 44) {
          return getUserMedia_(constraints, onSuccess, onError);
        }
        // Replace Firefox 44+'s deprecation warning with unprefixed version.
        utils.deprecated('navigator.getUserMedia',
            'navigator.mediaDevices.getUserMedia');
        navigator.mediaDevices.getUserMedia(constraints).then(onSuccess, onError);
      };
    };
    
    },{"../utils":14}],13:[function(require,module,exports){
    /*
     *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
     *
     *  Use of this source code is governed by a BSD-style license
     *  that can be found in the LICENSE file in the root of the source
     *  tree.
     */
    'use strict';
    var utils = require('../utils');
    
    module.exports = {
      shimLocalStreamsAPI: function(window) {
        if (typeof window !== 'object' || !window.RTCPeerConnection) {
          return;
        }
        if (!('getLocalStreams' in window.RTCPeerConnection.prototype)) {
          window.RTCPeerConnection.prototype.getLocalStreams = function() {
            if (!this._localStreams) {
              this._localStreams = [];
            }
            return this._localStreams;
          };
        }
        if (!('getStreamById' in window.RTCPeerConnection.prototype)) {
          window.RTCPeerConnection.prototype.getStreamById = function(id) {
            var result = null;
            if (this._localStreams) {
              this._localStreams.forEach(function(stream) {
                if (stream.id === id) {
                  result = stream;
                }
              });
            }
            if (this._remoteStreams) {
              this._remoteStreams.forEach(function(stream) {
                if (stream.id === id) {
                  result = stream;
                }
              });
            }
            return result;
          };
        }
        if (!('addStream' in window.RTCPeerConnection.prototype)) {
          var _addTrack = window.RTCPeerConnection.prototype.addTrack;
          window.RTCPeerConnection.prototype.addStream = function(stream) {
            if (!this._localStreams) {
              this._localStreams = [];
            }
            if (this._localStreams.indexOf(stream) === -1) {
              this._localStreams.push(stream);
            }
            var pc = this;
            stream.getTracks().forEach(function(track) {
              _addTrack.call(pc, track, stream);
            });
          };
    
          window.RTCPeerConnection.prototype.addTrack = function(track, stream) {
            if (stream) {
              if (!this._localStreams) {
                this._localStreams = [stream];
              } else if (this._localStreams.indexOf(stream) === -1) {
                this._localStreams.push(stream);
              }
            }
            return _addTrack.call(this, track, stream);
          };
        }
        if (!('removeStream' in window.RTCPeerConnection.prototype)) {
          window.RTCPeerConnection.prototype.removeStream = function(stream) {
            if (!this._localStreams) {
              this._localStreams = [];
            }
            var index = this._localStreams.indexOf(stream);
            if (index === -1) {
              return;
            }
            this._localStreams.splice(index, 1);
            var pc = this;
            var tracks = stream.getTracks();
            this.getSenders().forEach(function(sender) {
              if (tracks.indexOf(sender.track) !== -1) {
                pc.removeTrack(sender);
              }
            });
          };
        }
      },
      shimRemoteStreamsAPI: function(window) {
        if (typeof window !== 'object' || !window.RTCPeerConnection) {
          return;
        }
        if (!('getRemoteStreams' in window.RTCPeerConnection.prototype)) {
          window.RTCPeerConnection.prototype.getRemoteStreams = function() {
            return this._remoteStreams ? this._remoteStreams : [];
          };
        }
        if (!('onaddstream' in window.RTCPeerConnection.prototype)) {
          Object.defineProperty(window.RTCPeerConnection.prototype, 'onaddstream', {
            get: function() {
              return this._onaddstream;
            },
            set: function(f) {
              if (this._onaddstream) {
                this.removeEventListener('addstream', this._onaddstream);
              }
              this.addEventListener('addstream', this._onaddstream = f);
            }
          });
          var origSetRemoteDescription =
              window.RTCPeerConnection.prototype.setRemoteDescription;
          window.RTCPeerConnection.prototype.setRemoteDescription = function() {
            var pc = this;
            if (!this._onaddstreampoly) {
              this.addEventListener('track', this._onaddstreampoly = function(e) {
                e.streams.forEach(function(stream) {
                  if (!pc._remoteStreams) {
                    pc._remoteStreams = [];
                  }
                  if (pc._remoteStreams.indexOf(stream) >= 0) {
                    return;
                  }
                  pc._remoteStreams.push(stream);
                  var event = new Event('addstream');
                  event.stream = stream;
                  pc.dispatchEvent(event);
                });
              });
            }
            return origSetRemoteDescription.apply(pc, arguments);
          };
        }
      },
      shimCallbacksAPI: function(window) {
        if (typeof window !== 'object' || !window.RTCPeerConnection) {
          return;
        }
        var prototype = window.RTCPeerConnection.prototype;
        var createOffer = prototype.createOffer;
        var createAnswer = prototype.createAnswer;
        var setLocalDescription = prototype.setLocalDescription;
        var setRemoteDescription = prototype.setRemoteDescription;
        var addIceCandidate = prototype.addIceCandidate;
    
        prototype.createOffer = function(successCallback, failureCallback) {
          var options = (arguments.length >= 2) ? arguments[2] : arguments[0];
          var promise = createOffer.apply(this, [options]);
          if (!failureCallback) {
            return promise;
          }
          promise.then(successCallback, failureCallback);
          return Promise.resolve();
        };
    
        prototype.createAnswer = function(successCallback, failureCallback) {
          var options = (arguments.length >= 2) ? arguments[2] : arguments[0];
          var promise = createAnswer.apply(this, [options]);
          if (!failureCallback) {
            return promise;
          }
          promise.then(successCallback, failureCallback);
          return Promise.resolve();
        };
    
        var withCallback = function(description, successCallback, failureCallback) {
          var promise = setLocalDescription.apply(this, [description]);
          if (!failureCallback) {
            return promise;
          }
          promise.then(successCallback, failureCallback);
          return Promise.resolve();
        };
        prototype.setLocalDescription = withCallback;
    
        withCallback = function(description, successCallback, failureCallback) {
          var promise = setRemoteDescription.apply(this, [description]);
          if (!failureCallback) {
            return promise;
          }
          promise.then(successCallback, failureCallback);
          return Promise.resolve();
        };
        prototype.setRemoteDescription = withCallback;
    
        withCallback = function(candidate, successCallback, failureCallback) {
          var promise = addIceCandidate.apply(this, [candidate]);
          if (!failureCallback) {
            return promise;
          }
          promise.then(successCallback, failureCallback);
          return Promise.resolve();
        };
        prototype.addIceCandidate = withCallback;
      },
      shimGetUserMedia: function(window) {
        var navigator = window && window.navigator;
    
        if (!navigator.getUserMedia) {
          if (navigator.webkitGetUserMedia) {
            navigator.getUserMedia = navigator.webkitGetUserMedia.bind(navigator);
          } else if (navigator.mediaDevices &&
              navigator.mediaDevices.getUserMedia) {
            navigator.getUserMedia = function(constraints, cb, errcb) {
              navigator.mediaDevices.getUserMedia(constraints)
              .then(cb, errcb);
            }.bind(navigator);
          }
        }
      },
      shimRTCIceServerUrls: function(window) {
        // migrate from non-spec RTCIceServer.url to RTCIceServer.urls
        var OrigPeerConnection = window.RTCPeerConnection;
        window.RTCPeerConnection = function(pcConfig, pcConstraints) {
          if (pcConfig && pcConfig.iceServers) {
            var newIceServers = [];
            for (var i = 0; i < pcConfig.iceServers.length; i++) {
              var server = pcConfig.iceServers[i];
              if (!server.hasOwnProperty('urls') &&
                  server.hasOwnProperty('url')) {
                utils.deprecated('RTCIceServer.url', 'RTCIceServer.urls');
                server = JSON.parse(JSON.stringify(server));
                server.urls = server.url;
                delete server.url;
                newIceServers.push(server);
              } else {
                newIceServers.push(pcConfig.iceServers[i]);
              }
            }
            pcConfig.iceServers = newIceServers;
          }
          return new OrigPeerConnection(pcConfig, pcConstraints);
        };
        window.RTCPeerConnection.prototype = OrigPeerConnection.prototype;
        // wrap static methods. Currently just generateCertificate.
        if ('generateCertificate' in window.RTCPeerConnection) {
          Object.defineProperty(window.RTCPeerConnection, 'generateCertificate', {
            get: function() {
              return OrigPeerConnection.generateCertificate;
            }
          });
        }
      },
      shimTrackEventTransceiver: function(window) {
        // Add event.transceiver member over deprecated event.receiver
        if (typeof window === 'object' && window.RTCPeerConnection &&
            ('receiver' in window.RTCTrackEvent.prototype) &&
            // can't check 'transceiver' in window.RTCTrackEvent.prototype, as it is
            // defined for some reason even when window.RTCTransceiver is not.
            !window.RTCTransceiver) {
          Object.defineProperty(window.RTCTrackEvent.prototype, 'transceiver', {
            get: function() {
              return {receiver: this.receiver};
            }
          });
        }
      },
    
      shimCreateOfferLegacy: function(window) {
        var origCreateOffer = window.RTCPeerConnection.prototype.createOffer;
        window.RTCPeerConnection.prototype.createOffer = function(offerOptions) {
          var pc = this;
          if (offerOptions) {
            if (typeof offerOptions.offerToReceiveAudio !== 'undefined') {
              // support bit values
              offerOptions.offerToReceiveAudio = !!offerOptions.offerToReceiveAudio;
            }
            var audioTransceiver = pc.getTransceivers().find(function(transceiver) {
              return transceiver.sender.track &&
                  transceiver.sender.track.kind === 'audio';
            });
            if (offerOptions.offerToReceiveAudio === false && audioTransceiver) {
              if (audioTransceiver.direction === 'sendrecv') {
                if (audioTransceiver.setDirection) {
                  audioTransceiver.setDirection('sendonly');
                } else {
                  audioTransceiver.direction = 'sendonly';
                }
              } else if (audioTransceiver.direction === 'recvonly') {
                if (audioTransceiver.setDirection) {
                  audioTransceiver.setDirection('inactive');
                } else {
                  audioTransceiver.direction = 'inactive';
                }
              }
            } else if (offerOptions.offerToReceiveAudio === true &&
                !audioTransceiver) {
              pc.addTransceiver('audio');
            }
    
    
            if (typeof offerOptions.offerToReceiveVideo !== 'undefined') {
              // support bit values
              offerOptions.offerToReceiveVideo = !!offerOptions.offerToReceiveVideo;
            }
            var videoTransceiver = pc.getTransceivers().find(function(transceiver) {
              return transceiver.sender.track &&
                  transceiver.sender.track.kind === 'video';
            });
            if (offerOptions.offerToReceiveVideo === false && videoTransceiver) {
              if (videoTransceiver.direction === 'sendrecv') {
                videoTransceiver.setDirection('sendonly');
              } else if (videoTransceiver.direction === 'recvonly') {
                videoTransceiver.setDirection('inactive');
              }
            } else if (offerOptions.offerToReceiveVideo === true &&
                !videoTransceiver) {
              pc.addTransceiver('video');
            }
          }
          return origCreateOffer.apply(pc, arguments);
        };
      }
    };
    
    },{"../utils":14}],14:[function(require,module,exports){
    /*
     *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
     *
     *  Use of this source code is governed by a BSD-style license
     *  that can be found in the LICENSE file in the root of the source
     *  tree.
     */
     /* eslint-env node */
    'use strict';
    
    var logDisabled_ = true;
    var deprecationWarnings_ = true;
    
    /**
     * Extract browser version out of the provided user agent string.
     *
     * @param {!string} uastring userAgent string.
     * @param {!string} expr Regular expression used as match criteria.
     * @param {!number} pos position in the version string to be returned.
     * @return {!number} browser version.
     */
    function extractVersion(uastring, expr, pos) {
      var match = uastring.match(expr);
      return match && match.length >= pos && parseInt(match[pos], 10);
    }
    
    // Wraps the peerconnection event eventNameToWrap in a function
    // which returns the modified event object (or false to prevent
    // the event).
    function wrapPeerConnectionEvent(window, eventNameToWrap, wrapper) {
      if (!window.RTCPeerConnection) {
        return;
      }
      var proto = window.RTCPeerConnection.prototype;
      var nativeAddEventListener = proto.addEventListener;
      proto.addEventListener = function(nativeEventName, cb) {
        if (nativeEventName !== eventNameToWrap) {
          return nativeAddEventListener.apply(this, arguments);
        }
        var wrappedCallback = function(e) {
          var modifiedEvent = wrapper(e);
          if (modifiedEvent) {
            cb(modifiedEvent);
          }
        };
        this._eventMap = this._eventMap || {};
        this._eventMap[cb] = wrappedCallback;
        return nativeAddEventListener.apply(this, [nativeEventName,
          wrappedCallback]);
      };
    
      var nativeRemoveEventListener = proto.removeEventListener;
      proto.removeEventListener = function(nativeEventName, cb) {
        if (nativeEventName !== eventNameToWrap || !this._eventMap
            || !this._eventMap[cb]) {
          return nativeRemoveEventListener.apply(this, arguments);
        }
        var unwrappedCb = this._eventMap[cb];
        delete this._eventMap[cb];
        return nativeRemoveEventListener.apply(this, [nativeEventName,
          unwrappedCb]);
      };
    
      Object.defineProperty(proto, 'on' + eventNameToWrap, {
        get: function() {
          return this['_on' + eventNameToWrap];
        },
        set: function(cb) {
          if (this['_on' + eventNameToWrap]) {
            this.removeEventListener(eventNameToWrap,
                this['_on' + eventNameToWrap]);
            delete this['_on' + eventNameToWrap];
          }
          if (cb) {
            this.addEventListener(eventNameToWrap,
                this['_on' + eventNameToWrap] = cb);
          }
        },
        enumerable: true,
        configurable: true
      });
    }
    
    // Utility methods.
    module.exports = {
      extractVersion: extractVersion,
      wrapPeerConnectionEvent: wrapPeerConnectionEvent,
      disableLog: function(bool) {
        if (typeof bool !== 'boolean') {
          return new Error('Argument type: ' + typeof bool +
              '. Please use a boolean.');
        }
        logDisabled_ = bool;
        return (bool) ? 'adapter.js logging disabled' :
            'adapter.js logging enabled';
      },
    
      /**
       * Disable or enable deprecation warnings
       * @param {!boolean} bool set to true to disable warnings.
       */
      disableWarnings: function(bool) {
        if (typeof bool !== 'boolean') {
          return new Error('Argument type: ' + typeof bool +
              '. Please use a boolean.');
        }
        deprecationWarnings_ = !bool;
        return 'adapter.js deprecation warnings ' + (bool ? 'disabled' : 'enabled');
      },
    
      log: function() {
        if (typeof window === 'object') {
          if (logDisabled_) {
            return;
          }
          if (typeof console !== 'undefined' && typeof console.log === 'function') {
            console.log.apply(console, arguments);
          }
        }
      },
    
      /**
       * Shows a deprecation warning suggesting the modern and spec-compatible API.
       */
      deprecated: function(oldMethod, newMethod) {
        if (!deprecationWarnings_) {
          return;
        }
        console.warn(oldMethod + ' is deprecated, please use ' + newMethod +
            ' instead.');
      },
    
      /**
       * Browser detector.
       *
       * @return {object} result containing browser and version
       *     properties.
       */
      detectBrowser: function(window) {
        var navigator = window && window.navigator;
    
        // Returned result object.
        var result = {};
        result.browser = null;
        result.version = null;
    
        // Fail early if it's not a browser
        if (typeof window === 'undefined' || !window.navigator) {
          result.browser = 'Not a browser.';
          return result;
        }
    
        if (navigator.mozGetUserMedia) { // Firefox.
          result.browser = 'firefox';
          result.version = extractVersion(navigator.userAgent,
              /Firefox\/(\d+)\./, 1);
        } else if (navigator.webkitGetUserMedia) {
          // Chrome, Chromium, Webview, Opera.
          // Version matches Chrome/WebRTC version.
          result.browser = 'chrome';
          result.version = extractVersion(navigator.userAgent,
              /Chrom(e|ium)\/(\d+)\./, 2);
        } else if (navigator.mediaDevices &&
            navigator.userAgent.match(/Edge\/(\d+).(\d+)$/)) { // Edge.
          result.browser = 'edge';
          result.version = extractVersion(navigator.userAgent,
              /Edge\/(\d+).(\d+)$/, 2);
        } else if (window.RTCPeerConnection &&
            navigator.userAgent.match(/AppleWebKit\/(\d+)\./)) { // Safari.
          result.browser = 'safari';
          result.version = extractVersion(navigator.userAgent,
              /AppleWebKit\/(\d+)\./, 1);
        } else { // Default fallthrough: not supported.
          result.browser = 'Not a supported browser.';
          return result;
        }
    
        return result;
      }
    };
    
    },{}]},{},[3])(3)
    });
    
!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var t;t="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this,t.flvjs=e()}}(function(){var e;return function(){function e(t,i,n){function r(a,o){if(!i[a]){if(!t[a]){var u="function"==typeof require&&require;if(!o&&u)return u(a,!0);if(s)return s(a,!0);var l=new Error("Cannot find module '"+a+"'");throw l.code="MODULE_NOT_FOUND",l}var h=i[a]={exports:{}};t[a][0].call(h.exports,function(e){return r(t[a][1][e]||e)},h,h.exports,e,t,i,n)}return i[a].exports}for(var s="function"==typeof require&&require,a=0;a<n.length;a++)r(n[a]);return r}return e}()({1:[function(t,i,n){(function(r,s){!function(t,r){"object"==typeof n&&void 0!==i?i.exports=r():"function"==typeof e&&e.amd?e(r):t.ES6Promise=r()}(this,function(){"use strict";function e(e){var t=typeof e;return null!==e&&("object"===t||"function"===t)}function i(e){return"function"==typeof e}function n(e){G=e}function a(e){V=e}function o(){return void 0!==z?function(){z(l)}:u()}function u(){var e=setTimeout;return function(){return e(l,1)}}function l(){for(var e=0;e<F;e+=2){(0,Y[e])(Y[e+1]),Y[e]=void 0,Y[e+1]=void 0}F=0}function h(e,t){var i=this,n=new this.constructor(c);void 0===n[$]&&T(n);var r=i._state;if(r){var s=arguments[r-1];V(function(){return A(r,n,s,i._result)})}else w(i,n,e,t);return n}function d(e){var t=this;if(e&&"object"==typeof e&&e.constructor===t)return e;var i=new t(c);return b(i,e),i}function c(){}function f(){return new TypeError("You cannot resolve a promise with itself")}function _(){return new TypeError("A promises callback cannot return that same promise.")}function p(e){try{return e.then}catch(e){return te.error=e,te}}function m(e,t,i,n){try{e.call(t,i,n)}catch(e){return e}}function v(e,t,i){V(function(e){var n=!1,r=m(i,t,function(i){n||(n=!0,t!==i?b(e,i):S(e,i))},function(t){n||(n=!0,k(e,t))},"Settle: "+(e._label||" unknown promise"));!n&&r&&(n=!0,k(e,r))},e)}function g(e,t){t._state===J?S(e,t._result):t._state===ee?k(e,t._result):w(t,void 0,function(t){return b(e,t)},function(t){return k(e,t)})}function y(e,t,n){t.constructor===e.constructor&&n===h&&t.constructor.resolve===d?g(e,t):n===te?(k(e,te.error),te.error=null):void 0===n?S(e,t):i(n)?v(e,t,n):S(e,t)}function b(t,i){t===i?k(t,f()):e(i)?y(t,i,p(i)):S(t,i)}function E(e){e._onerror&&e._onerror(e._result),L(e)}function S(e,t){e._state===Q&&(e._result=t,e._state=J,0!==e._subscribers.length&&V(L,e))}function k(e,t){e._state===Q&&(e._state=ee,e._result=t,V(E,e))}function w(e,t,i,n){var r=e._subscribers,s=r.length;e._onerror=null,r[s]=t,r[s+J]=i,r[s+ee]=n,0===s&&e._state&&V(L,e)}function L(e){var t=e._subscribers,i=e._state;if(0!==t.length){for(var n=void 0,r=void 0,s=e._result,a=0;a<t.length;a+=3)n=t[a],r=t[a+i],n?A(i,n,r,s):r(s);e._subscribers.length=0}}function R(e,t){try{return e(t)}catch(e){return te.error=e,te}}function A(e,t,n,r){var s=i(n),a=void 0,o=void 0,u=void 0,l=void 0;if(s){if(a=R(n,r),a===te?(l=!0,o=a.error,a.error=null):u=!0,t===a)return void k(t,_())}else a=r,u=!0;t._state!==Q||(s&&u?b(t,a):l?k(t,o):e===J?S(t,a):e===ee&&k(t,a))}function O(e,t){try{t(function(t){b(e,t)},function(t){k(e,t)})}catch(t){k(e,t)}}function x(){return ie++}function T(e){e[$]=ie++,e._state=void 0,e._result=void 0,e._subscribers=[]}function C(){return new Error("Array Methods must be provided an Array")}function B(e){return new ne(this,e).promise}function D(e){var t=this;return new t(N(e)?function(i,n){for(var r=e.length,s=0;s<r;s++)t.resolve(e[s]).then(i,n)}:function(e,t){return t(new TypeError("You must pass an array to race."))})}function I(e){var t=this,i=new t(c);return k(i,e),i}function M(){throw new TypeError("You must pass a resolver function as the first argument to the promise constructor")}function j(){throw new TypeError("Failed to construct 'Promise': Please use the 'new' operator, this object constructor cannot be called as a function.")}function P(){var e=void 0;if(void 0!==s)e=s;else if("undefined"!=typeof self)e=self;else try{e=Function("return this")()}catch(e){throw new Error("polyfill failed because global object is unavailable in this environment")}var t=e.Promise;if(t){var i=null;try{i=Object.prototype.toString.call(t.resolve())}catch(e){}if("[object Promise]"===i&&!t.cast)return}e.Promise=re}var U=void 0;U=Array.isArray?Array.isArray:function(e){return"[object Array]"===Object.prototype.toString.call(e)};var N=U,F=0,z=void 0,G=void 0,V=function(e,t){Y[F]=e,Y[F+1]=t,2===(F+=2)&&(G?G(l):Z())},H="undefined"!=typeof window?window:void 0,q=H||{},K=q.MutationObserver||q.WebKitMutationObserver,W="undefined"==typeof self&&void 0!==r&&"[object process]"==={}.toString.call(r),X="undefined"!=typeof Uint8ClampedArray&&"undefined"!=typeof importScripts&&"undefined"!=typeof MessageChannel,Y=new Array(1e3),Z=void 0;Z=W?function(){return function(){return r.nextTick(l)}}():K?function(){var e=0,t=new K(l),i=document.createTextNode("");return t.observe(i,{characterData:!0}),function(){i.data=e=++e%2}}():X?function(){var e=new MessageChannel;return e.port1.onmessage=l,function(){return e.port2.postMessage(0)}}():void 0===H&&"function"==typeof t?function(){try{var e=Function("return this")().require("vertx");return z=e.runOnLoop||e.runOnContext,o()}catch(e){return u()}}():u();var $=Math.random().toString(36).substring(2),Q=void 0,J=1,ee=2,te={error:null},ie=0,ne=function(){function e(e,t){this._instanceConstructor=e,this.promise=new e(c),this.promise[$]||T(this.promise),N(t)?(this.length=t.length,this._remaining=t.length,this._result=new Array(this.length),0===this.length?S(this.promise,this._result):(this.length=this.length||0,this._enumerate(t),0===this._remaining&&S(this.promise,this._result))):k(this.promise,C())}return e.prototype._enumerate=function(e){for(var t=0;this._state===Q&&t<e.length;t++)this._eachEntry(e[t],t)},e.prototype._eachEntry=function(e,t){var i=this._instanceConstructor,n=i.resolve;if(n===d){var r=p(e);if(r===h&&e._state!==Q)this._settledAt(e._state,t,e._result);else if("function"!=typeof r)this._remaining--,this._result[t]=e;else if(i===re){var s=new i(c);y(s,e,r),this._willSettleAt(s,t)}else this._willSettleAt(new i(function(t){return t(e)}),t)}else this._willSettleAt(n(e),t)},e.prototype._settledAt=function(e,t,i){var n=this.promise;n._state===Q&&(this._remaining--,e===ee?k(n,i):this._result[t]=i),0===this._remaining&&S(n,this._result)},e.prototype._willSettleAt=function(e,t){var i=this;w(e,void 0,function(e){return i._settledAt(J,t,e)},function(e){return i._settledAt(ee,t,e)})},e}(),re=function(){function e(t){this[$]=x(),this._result=this._state=void 0,this._subscribers=[],c!==t&&("function"!=typeof t&&M(),this instanceof e?O(this,t):j())}return e.prototype.catch=function(e){return this.then(null,e)},e.prototype.finally=function(e){var t=this,n=t.constructor;return i(e)?t.then(function(t){return n.resolve(e()).then(function(){return t})},function(t){return n.resolve(e()).then(function(){throw t})}):t.then(e,e)},e}();return re.prototype.then=h,re.all=B,re.race=D,re.resolve=d,re.reject=I,re._setScheduler=n,re._setAsap=a,re._asap=V,re.polyfill=P,re.Promise=re,re})}).call(this,t("_process"),"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{_process:3}],2:[function(e,t,i){function n(){this._events=this._events||{},this._maxListeners=this._maxListeners||void 0}function r(e){return"function"==typeof e}function s(e){return"number"==typeof e}function a(e){return"object"==typeof e&&null!==e}function o(e){return void 0===e}t.exports=n,n.EventEmitter=n,n.prototype._events=void 0,n.prototype._maxListeners=void 0,n.defaultMaxListeners=10,n.prototype.setMaxListeners=function(e){if(!s(e)||e<0||isNaN(e))throw TypeError("n must be a positive number");return this._maxListeners=e,this},n.prototype.emit=function(e){var t,i,n,s,u,l;if(this._events||(this._events={}),"error"===e&&(!this._events.error||a(this._events.error)&&!this._events.error.length)){if((t=arguments[1])instanceof Error)throw t;var h=new Error('Uncaught, unspecified "error" event. ('+t+")");throw h.context=t,h}if(i=this._events[e],o(i))return!1;if(r(i))switch(arguments.length){case 1:i.call(this);break;case 2:i.call(this,arguments[1]);break;case 3:i.call(this,arguments[1],arguments[2]);break;default:s=Array.prototype.slice.call(arguments,1),i.apply(this,s)}else if(a(i))for(s=Array.prototype.slice.call(arguments,1),l=i.slice(),n=l.length,u=0;u<n;u++)l[u].apply(this,s);return!0},n.prototype.addListener=function(e,t){var i;if(!r(t))throw TypeError("listener must be a function");return this._events||(this._events={}),this._events.newListener&&this.emit("newListener",e,r(t.listener)?t.listener:t),this._events[e]?a(this._events[e])?this._events[e].push(t):this._events[e]=[this._events[e],t]:this._events[e]=t,a(this._events[e])&&!this._events[e].warned&&(i=o(this._maxListeners)?n.defaultMaxListeners:this._maxListeners)&&i>0&&this._events[e].length>i&&(this._events[e].warned=!0,console.error("(node) warning: possible EventEmitter memory leak detected. %d listeners added. Use emitter.setMaxListeners() to increase limit.",this._events[e].length),"function"==typeof console.trace&&console.trace()),this},n.prototype.on=n.prototype.addListener,n.prototype.once=function(e,t){function i(){this.removeListener(e,i),n||(n=!0,t.apply(this,arguments))}if(!r(t))throw TypeError("listener must be a function");var n=!1;return i.listener=t,this.on(e,i),this},n.prototype.removeListener=function(e,t){var i,n,s,o;if(!r(t))throw TypeError("listener must be a function");if(!this._events||!this._events[e])return this;if(i=this._events[e],s=i.length,n=-1,i===t||r(i.listener)&&i.listener===t)delete this._events[e],this._events.removeListener&&this.emit("removeListener",e,t);else if(a(i)){for(o=s;o-- >0;)if(i[o]===t||i[o].listener&&i[o].listener===t){n=o;break}if(n<0)return this;1===i.length?(i.length=0,delete this._events[e]):i.splice(n,1),this._events.removeListener&&this.emit("removeListener",e,t)}return this},n.prototype.removeAllListeners=function(e){var t,i;if(!this._events)return this;if(!this._events.removeListener)return 0===arguments.length?this._events={}:this._events[e]&&delete this._events[e],this;if(0===arguments.length){for(t in this._events)"removeListener"!==t&&this.removeAllListeners(t);return this.removeAllListeners("removeListener"),this._events={},this}if(i=this._events[e],r(i))this.removeListener(e,i);else if(i)for(;i.length;)this.removeListener(e,i[i.length-1]);return delete this._events[e],this},n.prototype.listeners=function(e){return this._events&&this._events[e]?r(this._events[e])?[this._events[e]]:this._events[e].slice():[]},n.prototype.listenerCount=function(e){if(this._events){var t=this._events[e];if(r(t))return 1;if(t)return t.length}return 0},n.listenerCount=function(e,t){return e.listenerCount(t)}},{}],3:[function(e,t,i){function n(){throw new Error("setTimeout has not been defined")}function r(){throw new Error("clearTimeout has not been defined")}function s(e){if(d===setTimeout)return setTimeout(e,0);if((d===n||!d)&&setTimeout)return d=setTimeout,setTimeout(e,0);try{return d(e,0)}catch(t){try{return d.call(null,e,0)}catch(t){return d.call(this,e,0)}}}function a(e){if(c===clearTimeout)return clearTimeout(e);if((c===r||!c)&&clearTimeout)return c=clearTimeout,clearTimeout(e);try{return c(e)}catch(t){try{return c.call(null,e)}catch(t){return c.call(this,e)}}}function o(){m&&_&&(m=!1,_.length?p=_.concat(p):v=-1,p.length&&u())}function u(){if(!m){var e=s(o);m=!0;for(var t=p.length;t;){for(_=p,p=[];++v<t;)_&&_[v].run();v=-1,t=p.length}_=null,m=!1,a(e)}}function l(e,t){this.fun=e,this.array=t}function h(){}var d,c,f=t.exports={};!function(){try{d="function"==typeof setTimeout?setTimeout:n}catch(e){d=n}try{c="function"==typeof clearTimeout?clearTimeout:r}catch(e){c=r}}();var _,p=[],m=!1,v=-1;f.nextTick=function(e){var t=new Array(arguments.length-1);if(arguments.length>1)for(var i=1;i<arguments.length;i++)t[i-1]=arguments[i];p.push(new l(e,t)),1!==p.length||m||s(u)},l.prototype.run=function(){this.fun.apply(null,this.array)},f.title="browser",f.browser=!0,f.env={},f.argv=[],f.version="",f.versions={},f.on=h,f.addListener=h,f.once=h,f.off=h,f.removeListener=h,f.removeAllListeners=h,f.emit=h,f.prependListener=h,f.prependOnceListener=h,f.listeners=function(e){return[]},f.binding=function(e){throw new Error("process.binding is not supported")},f.cwd=function(){return"/"},f.chdir=function(e){throw new Error("process.chdir is not supported")},f.umask=function(){return 0}},{}],4:[function(e,t,i){var n=arguments[3],r=arguments[4],s=arguments[5],a=JSON.stringify;t.exports=function(e,t){function i(e){m[e]=!0;for(var t in r[e][1]){var n=r[e][1][t];m[n]||i(n)}}for(var o,u=Object.keys(s),l=0,h=u.length;l<h;l++){var d=u[l],c=s[d].exports;if(c===e||c&&c.default===e){o=d;break}}if(!o){o=Math.floor(Math.pow(16,8)*Math.random()).toString(16);for(var f={},l=0,h=u.length;l<h;l++){var d=u[l];f[d]=d}r[o]=["function(require,module,exports){"+e+"(self); }",f]}var _=Math.floor(Math.pow(16,8)*Math.random()).toString(16),p={};p[o]=o,r[_]=["function(require,module,exports){var f = require("+a(o)+");(f.default ? f.default : f)(self);}",p];var m={};i(_);var v="("+n+")({"+Object.keys(m).map(function(e){return a(e)+":["+r[e][0]+","+a(r[e][1])+"]"}).join(",")+"},{},["+a(_)+"])",g=window.URL||window.webkitURL||window.mozURL||window.msURL,y=new Blob([v],{type:"text/javascript"});if(t&&t.bare)return y;var b=g.createObjectURL(y),E=new Worker(b);return E.objectURL=b,E}},{}],5:[function(e,t,i){"use strict";function n(){return Object.assign({},r)}Object.defineProperty(i,"__esModule",{value:!0}),i.createDefaultConfig=n;var r=i.defaultConfig={enableWorker:!1,enableStashBuffer:!0,stashInitialSize:void 0,isLive:!1,lazyLoad:!0,lazyLoadMaxDuration:3600,lazyLoadRecoverDuration:30,deferLoadAfterSourceOpen:!0,autoCleanupMaxBackwardDuration:180,autoCleanupMinBackwardDuration:120,statisticsInfoReportInterval:600,fixAudioTimestampGap:!0,accurateSeek:!1,seekType:"range",seekParamStart:"bstart",seekParamEnd:"bend",rangeLoadZeroStart:!1,customSeekHandler:void 0,reuseRedirectedURL:!1}},{}],6:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var r=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),s=e("../io/io-controller.js"),a=function(e){return e&&e.__esModule?e:{default:e}}(s),o=e("../config.js"),u=function(){function e(){n(this,e)}return r(e,null,[{key:"supportMSEH264Playback",value:function(){return window.MediaSource&&window.MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')}},{key:"supportNetworkStreamIO",value:function(){var e=new a.default({},(0,o.createDefaultConfig)()),t=e.loaderType;return e.destroy(),"fetch-stream-loader"==t||"xhr-moz-chunked-loader"==t}},{key:"getNetworkLoaderTypeName",value:function(){var e=new a.default({},(0,o.createDefaultConfig)()),t=e.loaderType;return e.destroy(),t}},{key:"supportNativeMediaPlayback",value:function(t){void 0==e.videoElement&&(e.videoElement=window.document.createElement("video"));var i=e.videoElement.canPlayType(t);return"probably"===i||"maybe"==i}},{key:"getFeatureList",value:function(){var t={mseFlvPlayback:!1,mseLiveFlvPlayback:!1,networkStreamIO:!1,networkLoaderName:"",nativeMP4H264Playback:!1,nativeWebmVP8Playback:!1,nativeWebmVP9Playback:!1};return t.mseFlvPlayback=e.supportMSEH264Playback(),t.networkStreamIO=e.supportNetworkStreamIO(),t.networkLoaderName=e.getNetworkLoaderTypeName(),t.mseLiveFlvPlayback=t.mseFlvPlayback&&t.networkStreamIO,t.nativeMP4H264Playback=e.supportNativeMediaPlayback('video/mp4; codecs="avc1.42001E, mp4a.40.2"'),t.nativeWebmVP8Playback=e.supportNativeMediaPlayback('video/webm; codecs="vp8.0, vorbis"'),t.nativeWebmVP9Playback=e.supportNativeMediaPlayback('video/webm; codecs="vp9"'),t}}]),e}();i.default=u},{"../config.js":5,"../io/io-controller.js":24}],7:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var r=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),s=function(){function e(){n(this,e),this.mimeType=null,this.duration=null,this.hasAudio=null,this.hasVideo=null,this.audioCodec=null,this.videoCodec=null,this.audioDataRate=null,this.videoDataRate=null,this.audioSampleRate=null,this.audioChannelCount=null,this.width=null,this.height=null,this.fps=null,this.profile=null,this.level=null,this.chromaFormat=null,this.sarNum=null,this.sarDen=null,this.metadata=null,this.segments=null,this.segmentCount=null,this.hasKeyframesIndex=null,this.keyframesIndex=null}return r(e,[{key:"isComplete",value:function(){var e=!1===this.hasAudio||!0===this.hasAudio&&null!=this.audioCodec&&null!=this.audioSampleRate&&null!=this.audioChannelCount,t=!1===this.hasVideo||!0===this.hasVideo&&null!=this.videoCodec&&null!=this.width&&null!=this.height&&null!=this.fps&&null!=this.profile&&null!=this.level&&null!=this.chromaFormat&&null!=this.sarNum&&null!=this.sarDen;return null!=this.mimeType&&null!=this.duration&&null!=this.metadata&&null!=this.hasKeyframesIndex&&e&&t}},{key:"isSeekable",value:function(){return!0===this.hasKeyframesIndex}},{key:"getNearestKeyframe",value:function(e){if(null==this.keyframesIndex)return null;var t=this.keyframesIndex,i=this._search(t.times,e);return{index:i,milliseconds:t.times[i],fileposition:t.filepositions[i]}}},{key:"_search",value:function(e,t){var i=0,n=e.length-1,r=0,s=0,a=n;for(t<e[0]&&(i=0,s=a+1);s<=a;){if((r=s+Math.floor((a-s)/2))===n||t>=e[r]&&t<e[r+1]){i=r;break}e[r]<t?s=r+1:a=r-1}return i}}]),e}();i.default=s},{}],8:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var r=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}();i.SampleInfo=function e(t,i,r,s,a){n(this,e),this.dts=t,this.pts=i,this.duration=r,this.originalDts=s,this.isSyncPoint=a,this.fileposition=null},i.MediaSegmentInfo=function(){function e(){n(this,e),this.beginDts=0,this.endDts=0,this.beginPts=0,this.endPts=0,this.originalBeginDts=0,this.originalEndDts=0,this.syncPoints=[],this.firstSample=null,this.lastSample=null}return r(e,[{key:"appendSyncPoint",value:function(e){e.isSyncPoint=!0,this.syncPoints.push(e)}}]),e}(),i.IDRSampleList=function(){function e(){n(this,e),this._list=[]}return r(e,[{key:"clear",value:function(){this._list=[]}},{key:"appendArray",value:function(e){var t=this._list;0!==e.length&&(t.length>0&&e[0].originalDts<t[t.length-1].originalDts&&this.clear(),Array.prototype.push.apply(t,e))}},{key:"getLastSyncPointBeforeDts",value:function(e){if(0==this._list.length)return null;var t=this._list,i=0,n=t.length-1,r=0,s=0,a=n;for(e<t[0].dts&&(i=0,s=a+1);s<=a;){if((r=s+Math.floor((a-s)/2))===n||e>=t[r].dts&&e<t[r+1].dts){i=r;break}t[r].dts<e?s=r+1:a=r-1}return this._list[i]}}]),e}(),i.MediaSegmentInfoList=function(){function e(t){n(this,e),this._type=t,this._list=[],this._lastAppendLocation=-1}return r(e,[{key:"isEmpty",value:function(){return 0===this._list.length}},{key:"clear",value:function(){this._list=[],this._lastAppendLocation=-1}},{key:"_searchNearestSegmentBefore",value:function(e){var t=this._list;if(0===t.length)return-2;var i=t.length-1,n=0,r=0,s=i,a=0;if(e<t[0].originalBeginDts)return a=-1;for(;r<=s;){if((n=r+Math.floor((s-r)/2))===i||e>t[n].lastSample.originalDts&&e<t[n+1].originalBeginDts){a=n;break}t[n].originalBeginDts<e?r=n+1:s=n-1}return a}},{key:"_searchNearestSegmentAfter",value:function(e){return this._searchNearestSegmentBefore(e)+1}},{key:"append",value:function(e){var t=this._list,i=e,n=this._lastAppendLocation,r=0;-1!==n&&n<t.length&&i.originalBeginDts>=t[n].lastSample.originalDts&&(n===t.length-1||n<t.length-1&&i.originalBeginDts<t[n+1].originalBeginDts)?r=n+1:t.length>0&&(r=this._searchNearestSegmentBefore(i.originalBeginDts)+1),this._lastAppendLocation=r,this._list.splice(r,0,i)}},{key:"getLastSegmentBefore",value:function(e){var t=this._searchNearestSegmentBefore(e);return t>=0?this._list[t]:null}},{key:"getLastSampleBefore",value:function(e){var t=this.getLastSegmentBefore(e);return null!=t?t.lastSample:null}},{key:"getLastSyncPointBefore",value:function(e){for(var t=this._searchNearestSegmentBefore(e),i=this._list[t].syncPoints;0===i.length&&t>0;)t--,i=this._list[t].syncPoints;return i.length>0?i[i.length-1]:null}},{key:"type",get:function(){return this._type}},{key:"length",get:function(){return this._list.length}}]),e}()},{}],9:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var s=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),a=e("events"),o=n(a),u=e("../utils/logger.js"),l=n(u),h=e("../utils/browser.js"),d=n(h),c=e("./mse-events.js"),f=n(c),_=e("./media-segment-info.js"),p=e("../utils/exception.js"),m=function(){function e(t){r(this,e),this.TAG="MSEController",this._config=t,this._emitter=new o.default,this._config.isLive&&void 0==this._config.autoCleanupSourceBuffer&&(this._config.autoCleanupSourceBuffer=!0),this.e={onSourceOpen:this._onSourceOpen.bind(this),onSourceEnded:this._onSourceEnded.bind(this),onSourceClose:this._onSourceClose.bind(this),onSourceBufferError:this._onSourceBufferError.bind(this),onSourceBufferUpdateEnd:this._onSourceBufferUpdateEnd.bind(this)},this._mediaSource=null,this._mediaSourceObjectURL=null,this._mediaElement=null,this._isBufferFull=!1,this._hasPendingEos=!1,this._requireSetMediaDuration=!1,this._pendingMediaDuration=0,this._pendingSourceBufferInit=[],this._mimeTypes={video:null,audio:null},this._sourceBuffers={video:null,audio:null},this._lastInitSegments={video:null,audio:null},this._pendingSegments={video:[],audio:[]},this._pendingRemoveRanges={video:[],audio:[]},this._idrList=new _.IDRSampleList}return s(e,[{key:"destroy",value:function(){(this._mediaElement||this._mediaSource)&&this.detachMediaElement(),this.e=null,this._emitter.removeAllListeners(),this._emitter=null}},{key:"on",value:function(e,t){this._emitter.addListener(e,t)}},{key:"off",value:function(e,t){this._emitter.removeListener(e,t)}},{key:"attachMediaElement",value:function(e){if(this._mediaSource)throw new p.IllegalStateException("MediaSource has been attached to an HTMLMediaElement!");var t=this._mediaSource=new window.MediaSource;t.addEventListener("sourceopen",this.e.onSourceOpen),t.addEventListener("sourceended",this.e.onSourceEnded),t.addEventListener("sourceclose",this.e.onSourceClose),this._mediaElement=e,this._mediaSourceObjectURL=window.URL.createObjectURL(this._mediaSource),e.src=this._mediaSourceObjectURL}},{key:"detachMediaElement",value:function(){if(this._mediaSource){var e=this._mediaSource;for(var t in this._sourceBuffers){var i=this._pendingSegments[t];i.splice(0,i.length),this._pendingSegments[t]=null,this._pendingRemoveRanges[t]=null,this._lastInitSegments[t]=null;var n=this._sourceBuffers[t];n&&("closed"!==e.readyState&&(e.removeSourceBuffer(n),n.removeEventListener("error",this.e.onSourceBufferError),n.removeEventListener("updateend",this.e.onSourceBufferUpdateEnd)),this._mimeTypes[t]=null,this._sourceBuffers[t]=null)}if("open"===e.readyState)try{e.endOfStream()}catch(e){l.default.e(this.TAG,e.message)}e.removeEventListener("sourceopen",this.e.onSourceOpen),e.removeEventListener("sourceended",this.e.onSourceEnded),e.removeEventListener("sourceclose",this.e.onSourceClose),this._pendingSourceBufferInit=[],this._isBufferFull=!1,this._idrList.clear(),this._mediaSource=null}this._mediaElement&&(this._mediaElement.src="",this._mediaElement.removeAttribute("src"),this._mediaElement=null),this._mediaSourceObjectURL&&(window.URL.revokeObjectURL(this._mediaSourceObjectURL),this._mediaSourceObjectURL=null)}},{key:"appendInitSegment",value:function(e,t){if(!this._mediaSource||"open"!==this._mediaSource.readyState)return this._pendingSourceBufferInit.push(e),void this._pendingSegments[e.type].push(e);var i=e,n=""+i.container;i.codec&&i.codec.length>0&&(n+=";codecs="+i.codec);var r=!1;if(l.default.v(this.TAG,"Received Initialization Segment, mimeType: "+n),this._lastInitSegments[i.type]=i,n!==this._mimeTypes[i.type]){if(this._mimeTypes[i.type])l.default.v(this.TAG,"Notice: "+i.type+" mimeType changed, origin: "+this._mimeTypes[i.type]+", target: "+n);else{r=!0;try{if("audio"===i.type&&!this._sourceBuffers.video&&(void 0===this._config.hasAudio||this._config.hasAudio)){var s=this._sourceBuffers.video=this._mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E');s.addEventListener("error",this.e.onSourceBufferError),s.addEventListener("updateend",this.e.onSourceBufferUpdateEnd),s.mode="sequence",this._mimeTypes.video='video/mp4; codecs="avc1.42E01E'}var a=this._sourceBuffers[i.type]=this._mediaSource.addSourceBuffer(n);a.addEventListener("error",this.e.onSourceBufferError),a.addEventListener("updateend",this.e.onSourceBufferUpdateEnd),a.mode="sequence"}catch(e){return l.default.e(this.TAG,e.message),void this._emitter.emit(f.default.ERROR,{code:e.code,msg:e.message})}}this._mimeTypes[i.type]=n}t||this._pendingSegments[i.type].push(i),r||this._sourceBuffers[i.type]&&!this._sourceBuffers[i.type].updating&&this._doAppendSegments(),d.default.safari&&"audio/mpeg"===i.container&&i.mediaDuration>0&&(this._requireSetMediaDuration=!0,this._pendingMediaDuration=i.mediaDuration/1e3,this._updateMediaSourceDuration())}},{key:"appendMediaSegment",value:function(e){var t=e;this._pendingSegments[t.type].push(t),this._config.autoCleanupSourceBuffer&&this._needCleanupSourceBuffer()&&this._doCleanupSourceBuffer();var i=this._sourceBuffers[t.type];!i||i.updating||this._hasPendingRemoveRanges()||this._doAppendSegments()}},{key:"seek",value:function(e){for(var t in this._sourceBuffers)if(this._sourceBuffers[t]){var i=this._sourceBuffers[t];if("open"===this._mediaSource.readyState)try{i.abort()}catch(e){l.default.e(this.TAG,e.message)}this._idrList.clear();var n=this._pendingSegments[t];if(n.splice(0,n.length),"closed"!==this._mediaSource.readyState){for(var r=0;r<i.buffered.length;r++){var s=i.buffered.start(r),a=i.buffered.end(r);this._pendingRemoveRanges[t].push({start:s,end:a})}if(i.updating||this._doRemoveRanges(),d.default.safari){var o=this._lastInitSegments[t];o&&(this._pendingSegments[t].push(o),i.updating||this._doAppendSegments())}}}}},{key:"endOfStream",value:function(){var e=this._mediaSource,t=this._sourceBuffers;if(!e||"open"!==e.readyState)return void(e&&"closed"===e.readyState&&this._hasPendingSegments()&&(this._hasPendingEos=!0));t.video&&t.video.updating||t.audio&&t.audio.updating?this._hasPendingEos=!0:(this._hasPendingEos=!1,e.endOfStream())}},{key:"getNearestKeyframe",value:function(e){return this._idrList.getLastSyncPointBeforeDts(e)}},{key:"_needCleanupSourceBuffer",value:function(){if(!this._config.autoCleanupSourceBuffer)return!1;var e=this._mediaElement.currentTime;for(var t in this._sourceBuffers){var i=this._sourceBuffers[t];if(i){var n=i.buffered;if(n.length>=1&&e-n.start(0)>=this._config.autoCleanupMaxBackwardDuration)return!0}}return!1}},{key:"_doCleanupSourceBuffer",value:function(){var e=this._mediaElement.currentTime;for(var t in this._sourceBuffers){var i=this._sourceBuffers[t];if(i){for(var n=i.buffered,r=!1,s=0;s<n.length;s++){var a=n.start(s),o=n.end(s);if(a<=e&&e<o+3){if(e-a>=this._config.autoCleanupMaxBackwardDuration){r=!0;var u=e-this._config.autoCleanupMinBackwardDuration;this._pendingRemoveRanges[t].push({start:a,end:u})}}else o<e&&(r=!0,this._pendingRemoveRanges[t].push({start:a,end:o}))}r&&!i.updating&&this._doRemoveRanges()}}}},{key:"_updateMediaSourceDuration",value:function(){var e=this._sourceBuffers;if(0!==this._mediaElement.readyState&&"open"===this._mediaSource.readyState&&!(e.video&&e.video.updating||e.audio&&e.audio.updating)){var t=this._mediaSource.duration,i=this._pendingMediaDuration;i>0&&(isNaN(t)||i>t)&&(l.default.v(this.TAG,"Update MediaSource duration from "+t+" to "+i),this._mediaSource.duration=i),this._requireSetMediaDuration=!1,this._pendingMediaDuration=0}}},{key:"_doRemoveRanges",value:function(){for(var e in this._pendingRemoveRanges)if(this._sourceBuffers[e]&&!this._sourceBuffers[e].updating)for(var t=this._sourceBuffers[e],i=this._pendingRemoveRanges[e];i.length&&!t.updating;){var n=i.shift();n.start<n.end&&t.remove(n.start,n.end)}}},{key:"_doAppendSegments",value:function(){var e=this._pendingSegments;for(var t in e)if(this._sourceBuffers[t]&&!this._sourceBuffers[t].updating&&e[t].length>0){var i=e[t].shift();if(i.timestampOffset){var n=this._sourceBuffers[t].timestampOffset,r=i.timestampOffset/1e3,s=Math.abs(n-r);s>.1&&(l.default.v(this.TAG,"Update MPEG audio timestampOffset from "+n+" to "+r),this._sourceBuffers[t].timestampOffset=r),delete i.timestampOffset}if(!i.data||0===i.data.byteLength)continue;try{this._sourceBuffers[t].appendBuffer(i.data),this._isBufferFull=!1,"video"===t&&i.hasOwnProperty("info")&&this._idrList.appendArray(i.info.syncPoints)}catch(e){this._pendingSegments[t].unshift(i),22===e.code?(this._isBufferFull||this._emitter.emit(f.default.BUFFER_FULL),this._isBufferFull=!0):(l.default.e(this.TAG,e.message),this._emitter.emit(f.default.ERROR,{code:e.code,msg:e.message}))}}}},{key:"_onSourceOpen",value:function(){if(l.default.v(this.TAG,"MediaSource onSourceOpen"),this._mediaSource.removeEventListener("sourceopen",this.e.onSourceOpen),this._pendingSourceBufferInit.length>0)for(var e=this._pendingSourceBufferInit;e.length;){var t=e.shift();this.appendInitSegment(t,!0)}this._hasPendingSegments()&&this._doAppendSegments(),this._emitter.emit(f.default.SOURCE_OPEN)}},{key:"_onSourceEnded",value:function(){l.default.v(this.TAG,"MediaSource onSourceEnded")}},{key:"_onSourceClose",value:function(){l.default.v(this.TAG,"MediaSource onSourceClose"),this._mediaSource&&null!=this.e&&(this._mediaSource.removeEventListener("sourceopen",this.e.onSourceOpen),this._mediaSource.removeEventListener("sourceended",this.e.onSourceEnded),this._mediaSource.removeEventListener("sourceclose",this.e.onSourceClose))}},{key:"_hasPendingSegments",value:function(){var e=this._pendingSegments;return e.video.length>0||e.audio.length>0}},{key:"_hasPendingRemoveRanges",value:function(){var e=this._pendingRemoveRanges;return e.video.length>0||e.audio.length>0}},{key:"_onSourceBufferUpdateEnd",value:function(){this._requireSetMediaDuration?this._updateMediaSourceDuration():this._hasPendingRemoveRanges()?this._doRemoveRanges():this._hasPendingSegments()?this._doAppendSegments():this._hasPendingEos&&this.endOfStream(),this._emitter.emit(f.default.UPDATE_END)}},{key:"_onSourceBufferError",value:function(e){l.default.e(this.TAG,"SourceBuffer Error: "+e)}}]),e}();i.default=m},{"../utils/browser.js":40,"../utils/exception.js":41,"../utils/logger.js":42,"./media-segment-info.js":8,"./mse-events.js":10,events:2}],10:[function(e,t,i){"use strict";Object.defineProperty(i,"__esModule",{value:!0});var n={ERROR:"error",SOURCE_OPEN:"source_open",
UPDATE_END:"update_end",BUFFER_FULL:"buffer_full"};i.default=n},{}],11:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var s=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),a=e("events"),o=n(a),u=e("../utils/logger.js"),l=n(u),h=e("../utils/logging-control.js"),d=n(h),c=e("./transmuxing-controller.js"),f=n(c),_=e("./transmuxing-events.js"),p=n(_),m=e("./transmuxing-worker.js"),v=n(m),g=e("./media-info.js"),y=n(g),b=function(){function t(i,n){if(r(this,t),this.TAG="Transmuxer",this._emitter=new o.default,n.enableWorker&&"undefined"!=typeof Worker)try{var s=e("webworkify");this._worker=s(v.default),this._workerDestroying=!1,this._worker.addEventListener("message",this._onWorkerMessage.bind(this)),this._worker.postMessage({cmd:"init",param:[i,n]}),this.e={onLoggingConfigChanged:this._onLoggingConfigChanged.bind(this)},d.default.registerListener(this.e.onLoggingConfigChanged),this._worker.postMessage({cmd:"logging_config",param:d.default.getConfig()})}catch(e){l.default.e(this.TAG,"Error while initialize transmuxing worker, fallback to inline transmuxing"),this._worker=null,this._controller=new f.default(i,n)}else this._controller=new f.default(i,n);if(this._controller){var a=this._controller;a.on(p.default.IO_ERROR,this._onIOError.bind(this)),a.on(p.default.DEMUX_ERROR,this._onDemuxError.bind(this)),a.on(p.default.INIT_SEGMENT,this._onInitSegment.bind(this)),a.on(p.default.MEDIA_SEGMENT,this._onMediaSegment.bind(this)),a.on(p.default.LOADING_COMPLETE,this._onLoadingComplete.bind(this)),a.on(p.default.RECOVERED_EARLY_EOF,this._onRecoveredEarlyEof.bind(this)),a.on(p.default.MEDIA_INFO,this._onMediaInfo.bind(this)),a.on(p.default.STATISTICS_INFO,this._onStatisticsInfo.bind(this)),a.on(p.default.RECOMMEND_SEEKPOINT,this._onRecommendSeekpoint.bind(this))}}return s(t,[{key:"destroy",value:function(){this._worker?this._workerDestroying||(this._workerDestroying=!0,this._worker.postMessage({cmd:"destroy"}),d.default.removeListener(this.e.onLoggingConfigChanged),this.e=null):(this._controller.destroy(),this._controller=null),this._emitter.removeAllListeners(),this._emitter=null}},{key:"on",value:function(e,t){this._emitter.addListener(e,t)}},{key:"off",value:function(e,t){this._emitter.removeListener(e,t)}},{key:"hasWorker",value:function(){return null!=this._worker}},{key:"open",value:function(){this._worker?this._worker.postMessage({cmd:"start"}):this._controller.start()}},{key:"close",value:function(){this._worker?this._worker.postMessage({cmd:"stop"}):this._controller.stop()}},{key:"seek",value:function(e){this._worker?this._worker.postMessage({cmd:"seek",param:e}):this._controller.seek(e)}},{key:"pause",value:function(){this._worker?this._worker.postMessage({cmd:"pause"}):this._controller.pause()}},{key:"resume",value:function(){this._worker?this._worker.postMessage({cmd:"resume"}):this._controller.resume()}},{key:"_onInitSegment",value:function(e,t){var i=this;Promise.resolve().then(function(){i._emitter.emit(p.default.INIT_SEGMENT,e,t)})}},{key:"_onMediaSegment",value:function(e,t){var i=this;Promise.resolve().then(function(){i._emitter.emit(p.default.MEDIA_SEGMENT,e,t)})}},{key:"_onLoadingComplete",value:function(){var e=this;Promise.resolve().then(function(){e._emitter.emit(p.default.LOADING_COMPLETE)})}},{key:"_onRecoveredEarlyEof",value:function(){var e=this;Promise.resolve().then(function(){e._emitter.emit(p.default.RECOVERED_EARLY_EOF)})}},{key:"_onMediaInfo",value:function(e){var t=this;Promise.resolve().then(function(){t._emitter.emit(p.default.MEDIA_INFO,e)})}},{key:"_onStatisticsInfo",value:function(e){var t=this;Promise.resolve().then(function(){t._emitter.emit(p.default.STATISTICS_INFO,e)})}},{key:"_onIOError",value:function(e,t){var i=this;Promise.resolve().then(function(){i._emitter.emit(p.default.IO_ERROR,e,t)})}},{key:"_onDemuxError",value:function(e,t){var i=this;Promise.resolve().then(function(){i._emitter.emit(p.default.DEMUX_ERROR,e,t)})}},{key:"_onRecommendSeekpoint",value:function(e){var t=this;Promise.resolve().then(function(){t._emitter.emit(p.default.RECOMMEND_SEEKPOINT,e)})}},{key:"_onLoggingConfigChanged",value:function(e){this._worker&&this._worker.postMessage({cmd:"logging_config",param:e})}},{key:"_onWorkerMessage",value:function(e){var t=e.data,i=t.data;if("destroyed"===t.msg||this._workerDestroying)return this._workerDestroying=!1,this._worker.terminate(),void(this._worker=null);switch(t.msg){case p.default.INIT_SEGMENT:case p.default.MEDIA_SEGMENT:this._emitter.emit(t.msg,i.type,i.data);break;case p.default.LOADING_COMPLETE:case p.default.RECOVERED_EARLY_EOF:this._emitter.emit(t.msg);break;case p.default.MEDIA_INFO:Object.setPrototypeOf(i,y.default.prototype),this._emitter.emit(t.msg,i);break;case p.default.STATISTICS_INFO:this._emitter.emit(t.msg,i);break;case p.default.IO_ERROR:case p.default.DEMUX_ERROR:this._emitter.emit(t.msg,i.type,i.info);break;case p.default.RECOMMEND_SEEKPOINT:this._emitter.emit(t.msg,i);break;case"logcat_callback":l.default.emitter.emit("log",i.type,i.logcat)}}}]),t}();i.default=b},{"../utils/logger.js":42,"../utils/logging-control.js":43,"./media-info.js":7,"./transmuxing-controller.js":12,"./transmuxing-events.js":13,"./transmuxing-worker.js":14,events:2,webworkify:4}],12:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var s=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),a=e("events"),o=n(a),u=e("../utils/logger.js"),l=n(u),h=e("../utils/browser.js"),d=n(h),c=e("./media-info.js"),f=n(c),_=e("../demux/flv-demuxer.js"),p=n(_),m=e("../remux/mp4-remuxer.js"),v=n(m),g=e("../demux/demux-errors.js"),y=n(g),b=e("../io/io-controller.js"),E=n(b),S=e("./transmuxing-events.js"),k=n(S),w=(e("../io/loader.js"),function(){function e(t,i){r(this,e),this.TAG="TransmuxingController",this._emitter=new o.default,this._config=i,t.segments||(t.segments=[{duration:t.duration,filesize:t.filesize,url:t.url}]),"boolean"!=typeof t.cors&&(t.cors=!0),"boolean"!=typeof t.withCredentials&&(t.withCredentials=!1),this._mediaDataSource=t,this._currentSegmentIndex=0;var n=0;this._mediaDataSource.segments.forEach(function(e){e.timestampBase=n,n+=e.duration,e.cors=t.cors,e.withCredentials=t.withCredentials,i.referrerPolicy&&(e.referrerPolicy=i.referrerPolicy)}),isNaN(n)||this._mediaDataSource.duration===n||(this._mediaDataSource.duration=n),this._mediaInfo=null,this._demuxer=null,this._remuxer=null,this._ioctl=null,this._pendingSeekTime=null,this._pendingResolveSeekPoint=null,this._statisticsReporter=null,this._enableDecrypt=!1}return s(e,[{key:"destroy",value:function(){this._mediaInfo=null,this._mediaDataSource=null,this._statisticsReporter&&this._disableStatisticsReporter(),this._ioctl&&(this._ioctl.destroy(),this._ioctl=null),this._demuxer&&(this._demuxer.destroy(),this._demuxer=null),this._remuxer&&(this._remuxer.destroy(),this._remuxer=null),this._emitter.removeAllListeners(),this._emitter=null,this._enableDecrypt=!1}},{key:"on",value:function(e,t){this._emitter.addListener(e,t)}},{key:"off",value:function(e,t){this._emitter.removeListener(e,t)}},{key:"start",value:function(){this._loadSegment(0),this._enableStatisticsReporter()}},{key:"_loadSegment",value:function(e,t){this._currentSegmentIndex=e;var i=this._mediaDataSource.segments[e],n=this._ioctl=new E.default(i,this._config,e);n.onError=this._onIOException.bind(this),n.onSeeked=this._onIOSeeked.bind(this),n.onComplete=this._onIOComplete.bind(this),n.onRedirect=this._onIORedirect.bind(this),n.onRecoveredEarlyEof=this._onIORecoveredEarlyEof.bind(this),n.onOpened=this._onIOOpened.bind(this),t?this._demuxer.bindDataSource(this._ioctl):n.onDataArrival=this._onInitChunkArrival.bind(this),n.open(t)}},{key:"stop",value:function(){this._internalAbort(),this._disableStatisticsReporter()}},{key:"_internalAbort",value:function(){this._ioctl&&(this._ioctl.destroy(),this._ioctl=null)}},{key:"pause",value:function(){this._ioctl&&this._ioctl.isWorking()&&(this._ioctl.pause(),this._disableStatisticsReporter())}},{key:"resume",value:function(){this._ioctl&&this._ioctl.isPaused()&&(this._demuxer._firstParse=!0,this._demuxer._dataOffset=0,this._ioctl.resumeTime(this._remuxer._videoNextDts),this._enableStatisticsReporter())}},{key:"seek",value:function(e){if(null!=this._mediaInfo&&this._mediaInfo.isSeekable()){var t=this._searchSegmentIndexContains(e);if(t===this._currentSegmentIndex){var i=this._mediaInfo.segments[t];if(void 0==i)this._pendingSeekTime=e;else{var n=i.getNearestKeyframe(e);this._remuxer.seek(n.milliseconds),this._ioctl.seek(n.fileposition),this._pendingResolveSeekPoint=n.milliseconds}}else{var r=this._mediaInfo.segments[t];if(void 0==r)this._pendingSeekTime=e,this._internalAbort(),this._remuxer.seek(),this._remuxer.insertDiscontinuity(),this._loadSegment(t);else{var s=r.getNearestKeyframe(e);this._internalAbort(),this._remuxer.seek(e),this._remuxer.insertDiscontinuity(),this._demuxer.resetMediaInfo(),this._demuxer.timestampBase=this._mediaDataSource.segments[t].timestampBase,this._loadSegment(t,s.fileposition),this._pendingResolveSeekPoint=s.milliseconds,this._reportSegmentMediaInfo(t)}}this._enableStatisticsReporter()}}},{key:"_searchSegmentIndexContains",value:function(e){for(var t=this._mediaDataSource.segments,i=t.length-1,n=0;n<t.length;n++)if(e<t[n].timestampBase){i=n-1;break}return i}},{key:"_onInitChunkArrival",value:function(e,t){var i=this,n=null,r=0;if(t>0)this._demuxer.bindDataSource(this._ioctl),this._demuxer.timestampBase=this._mediaDataSource.segments[this._currentSegmentIndex].timestampBase,r=this._demuxer.parseChunks(e,t);else if((n=p.default.probe(e)).match){this._demuxer=new p.default(n,this._config),this._demuxer.enableDecrypt(this._enableDecrypt),this._remuxer||(this._remuxer=new v.default(this._config));var s=this._mediaDataSource;void 0==s.duration||isNaN(s.duration)||(this._demuxer.overridedDuration=s.duration),"boolean"==typeof s.hasAudio&&(this._demuxer.overridedHasAudio=s.hasAudio),"boolean"==typeof s.hasVideo&&(this._demuxer.overridedHasVideo=s.hasVideo),this._demuxer.timestampBase=s.segments[this._currentSegmentIndex].timestampBase,this._demuxer.onError=this._onDemuxException.bind(this),this._demuxer.onMediaInfo=this._onMediaInfo.bind(this),this._remuxer.bindDataSource(this._demuxer.bindDataSource(this._ioctl)),this._remuxer.onInitSegment=this._onRemuxerInitSegmentArrival.bind(this),this._remuxer.onMediaSegment=this._onRemuxerMediaSegmentArrival.bind(this),r=this._demuxer.parseChunks(e,t)}else n=null,l.default.e(this.TAG,"Non-FLV, Unsupported media type!"),Promise.resolve().then(function(){i._internalAbort()}),this._emitter.emit(k.default.DEMUX_ERROR,y.default.FORMAT_UNSUPPORTED,"Non-FLV, Unsupported media type"),r=0;return r}},{key:"_onMediaInfo",value:function(e){var t=this;null==this._mediaInfo&&(this._mediaInfo=Object.assign({},e),this._mediaInfo.keyframesIndex=null,this._mediaInfo.segments=[],this._mediaInfo.segmentCount=this._mediaDataSource.segments.length,Object.setPrototypeOf(this._mediaInfo,f.default.prototype));var i=Object.assign({},e);Object.setPrototypeOf(i,f.default.prototype),this._mediaInfo.segments[this._currentSegmentIndex]=i,this._reportSegmentMediaInfo(this._currentSegmentIndex),null!=this._pendingSeekTime&&Promise.resolve().then(function(){var e=t._pendingSeekTime;t._pendingSeekTime=null,t.seek(e)})}},{key:"_onIOOpened",value:function(e){this._enableDecrypt=e}},{key:"_onIOSeeked",value:function(){this._remuxer.insertDiscontinuity()}},{key:"_onIOComplete",value:function(e){var t=e,i=t+1;i<this._mediaDataSource.segments.length?(this._internalAbort(),this._loadSegment(i)):(this._emitter.emit(k.default.LOADING_COMPLETE),this._disableStatisticsReporter())}},{key:"_onIORedirect",value:function(e){var t=this._ioctl.extraData;this._mediaDataSource.segments[t].redirectedURL=e}},{key:"_onIORecoveredEarlyEof",value:function(){this._emitter.emit(k.default.RECOVERED_EARLY_EOF)}},{key:"_onIOException",value:function(e,t){l.default.e(this.TAG,"IOException: type = "+e+", code = "+t.code+", msg = "+t.msg),this._emitter.emit(k.default.IO_ERROR,e,t),this._disableStatisticsReporter()}},{key:"_onDemuxException",value:function(e,t){l.default.e(this.TAG,"DemuxException: type = "+e+", info = "+t),this._emitter.emit(k.default.DEMUX_ERROR,e,t)}},{key:"_onRemuxerInitSegmentArrival",value:function(e,t){this._emitter.emit(k.default.INIT_SEGMENT,e,t)}},{key:"_onRemuxerMediaSegmentArrival",value:function(e,t){if(null==this._pendingSeekTime&&(this._emitter.emit(k.default.MEDIA_SEGMENT,e,t),null!=this._pendingResolveSeekPoint&&"video"===e)){var i=t.info.syncPoints,n=this._pendingResolveSeekPoint;this._pendingResolveSeekPoint=null,d.default.safari&&i.length>0&&i[0].originalDts===n&&(n=i[0].pts),this._emitter.emit(k.default.RECOMMEND_SEEKPOINT,n)}}},{key:"_enableStatisticsReporter",value:function(){null==this._statisticsReporter&&(this._statisticsReporter=self.setInterval(this._reportStatisticsInfo.bind(this),this._config.statisticsInfoReportInterval))}},{key:"_disableStatisticsReporter",value:function(){this._statisticsReporter&&(self.clearInterval(this._statisticsReporter),this._statisticsReporter=null)}},{key:"_reportSegmentMediaInfo",value:function(e){var t=this._mediaInfo.segments[e],i=Object.assign({},t);i.duration=this._mediaInfo.duration,i.segmentCount=this._mediaInfo.segmentCount,delete i.segments,delete i.keyframesIndex,this._emitter.emit(k.default.MEDIA_INFO,i)}},{key:"_reportStatisticsInfo",value:function(){var e={};e.url=this._ioctl.currentURL,e.hasRedirect=this._ioctl.hasRedirect,e.hasRedirect&&(e.redirectedURL=this._ioctl.currentRedirectedURL),e.speed=this._ioctl.currentSpeed,e.loaderType=this._ioctl.loaderType,e.currentSegmentIndex=this._currentSegmentIndex,e.totalSegmentCount=this._mediaDataSource.segments.length,this._emitter.emit(k.default.STATISTICS_INFO,e)}}]),e}());i.default=w},{"../demux/demux-errors.js":17,"../demux/flv-demuxer.js":19,"../io/io-controller.js":24,"../io/loader.js":25,"../remux/mp4-remuxer.js":39,"../utils/browser.js":40,"../utils/logger.js":42,"./media-info.js":7,"./transmuxing-events.js":13,events:2}],13:[function(e,t,i){"use strict";Object.defineProperty(i,"__esModule",{value:!0});var n={IO_ERROR:"io_error",DEMUX_ERROR:"demux_error",INIT_SEGMENT:"init_segment",MEDIA_SEGMENT:"media_segment",LOADING_COMPLETE:"loading_complete",RECOVERED_EARLY_EOF:"recovered_early_eof",MEDIA_INFO:"media_info",STATISTICS_INFO:"statistics_info",RECOMMEND_SEEKPOINT:"recommend_seekpoint"};i.default=n},{}],14:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}Object.defineProperty(i,"__esModule",{value:!0});var r=e("../utils/logger.js"),s=(n(r),e("../utils/logging-control.js")),a=n(s),o=e("../utils/polyfill.js"),u=n(o),l=e("./transmuxing-controller.js"),h=n(l),d=e("./transmuxing-events.js"),c=n(d),f=function(e){function t(t,i){var n={msg:c.default.INIT_SEGMENT,data:{type:t,data:i}};e.postMessage(n,[i.data])}function i(t,i){var n={msg:c.default.MEDIA_SEGMENT,data:{type:t,data:i}};e.postMessage(n,[i.data])}function n(){var t={msg:c.default.LOADING_COMPLETE};e.postMessage(t)}function r(){var t={msg:c.default.RECOVERED_EARLY_EOF};e.postMessage(t)}function s(t){var i={msg:c.default.MEDIA_INFO,data:t};e.postMessage(i)}function o(t){var i={msg:c.default.STATISTICS_INFO,data:t};e.postMessage(i)}function l(t,i){e.postMessage({msg:c.default.IO_ERROR,data:{type:t,info:i}})}function d(t,i){e.postMessage({msg:c.default.DEMUX_ERROR,data:{type:t,info:i}})}function f(t){e.postMessage({msg:c.default.RECOMMEND_SEEKPOINT,data:t})}function _(t,i){e.postMessage({msg:"logcat_callback",data:{type:t,logcat:i}})}var p=null,m=_.bind(this);u.default.install(),e.addEventListener("message",function(u){switch(u.data.cmd){case"init":p=new h.default(u.data.param[0],u.data.param[1]),p.on(c.default.IO_ERROR,l.bind(this)),p.on(c.default.DEMUX_ERROR,d.bind(this)),p.on(c.default.INIT_SEGMENT,t.bind(this)),p.on(c.default.MEDIA_SEGMENT,i.bind(this)),p.on(c.default.LOADING_COMPLETE,n.bind(this)),p.on(c.default.RECOVERED_EARLY_EOF,r.bind(this)),p.on(c.default.MEDIA_INFO,s.bind(this)),p.on(c.default.STATISTICS_INFO,o.bind(this)),p.on(c.default.RECOMMEND_SEEKPOINT,f.bind(this));break;case"destroy":p&&(p.destroy(),p=null),e.postMessage({msg:"destroyed"});break;case"start":p.start();break;case"stop":p.stop();break;case"seek":p.seek(u.data.param);break;case"pause":p.pause();break;case"resume":p.resume();break;case"logging_config":var _=u.data.param;a.default.applyConfig(_),!0===_.enableCallback?a.default.addLogListener(m):a.default.removeLogListener(m)}})};i.default=f},{"../utils/logger.js":42,"../utils/logging-control.js":43,"../utils/polyfill.js":44,"./transmuxing-controller.js":12,"./transmuxing-events.js":13}],15:[function(e,t,i){"use strict";Object.defineProperty(i,"__esModule",{value:!0});var n=n||function(e,t){var i={},n=i.lib={},r=function(){},s=n.Base={extend:function(e){r.prototype=this;var t=new r;return e&&t.mixIn(e),t.hasOwnProperty("init")||(t.init=function(){t.$super.init.apply(this,arguments)}),t.init.prototype=t,t.$super=this,t},create:function(){var e=this.extend();return e.init.apply(e,arguments),e},init:function(){},mixIn:function(e){for(var t in e)e.hasOwnProperty(t)&&(this[t]=e[t]);e.hasOwnProperty("toString")&&(this.toString=e.toString)},clone:function(){return this.init.prototype.extend(this)}},a=n.WordArray=s.extend({init:function(e,t){e=this.words=e||[],this.sigBytes=void 0!=t?t:4*e.length},toString:function(e){return(e||u).stringify(this)},concat:function(e){var t=this.words,i=e.words,n=this.sigBytes;if(e=e.sigBytes,this.clamp(),n%4)for(var r=0;r<e;r++)t[n+r>>>2]|=(i[r>>>2]>>>24-r%4*8&255)<<24-(n+r)%4*8;else if(65535<i.length)for(r=0;r<e;r+=4)t[n+r>>>2]=i[r>>>2];else t.push.apply(t,i);return this.sigBytes+=e,this},clamp:function(){var t=this.words,i=this.sigBytes;t[i>>>2]&=4294967295<<32-i%4*8,t.length=e.ceil(i/4)},clone:function(){var e=s.clone.call(this);return e.words=this.words.slice(0),e},random:function(t){for(var i=[],n=0;n<t;n+=4)i.push(4294967296*e.random()|0);return new a.init(i,t)}}),o=i.enc={},u=o.Hex={stringify:function(e){var t=e.words;e=e.sigBytes;for(var i=[],n=0;n<e;n++){var r=t[n>>>2]>>>24-n%4*8&255;i.push((r>>>4).toString(16)),i.push((15&r).toString(16))}return i.join("")},parse:function(e){for(var t=e.length,i=[],n=0;n<t;n+=2)i[n>>>3]|=parseInt(e.substr(n,2),16)<<24-n%8*4;return new a.init(i,t/2)}},l=o.Latin1={stringify:function(e){var t=e.words;e=e.sigBytes;for(var i=[],n=0;n<e;n++)i.push(String.fromCharCode(t[n>>>2]>>>24-n%4*8&255));return i.join("")},parse:function(e){for(var t=e.length,i=[],n=0;n<t;n++)i[n>>>2]|=(255&e.charCodeAt(n))<<24-n%4*8;return new a.init(i,t)}},h=o.Utf8={stringify:function(e){try{return decodeURIComponent(escape(l.stringify(e)))}catch(e){throw Error("Malformed UTF-8 data")}},parse:function(e){return l.parse(unescape(encodeURIComponent(e)))}},d=n.BufferedBlockAlgorithm=s.extend({reset:function(){this._data=new a.init,this._nDataBytes=0},_append:function(e){"string"==typeof e&&(e=h.parse(e)),this._data.concat(e),this._nDataBytes+=e.sigBytes},_process:function(t){var i=this._data,n=i.words,r=i.sigBytes,s=this.blockSize,o=r/(4*s),o=t?e.ceil(o):e.max((0|o)-this._minBufferSize,0);if(t=o*s,r=e.min(4*t,r),t){for(var u=0;u<t;u+=s)this._doProcessBlock(n,u);u=n.splice(0,t),i.sigBytes-=r}return new a.init(u,r)},clone:function(){var e=s.clone.call(this);return e._data=this._data.clone(),e},_minBufferSize:0});n.Hasher=d.extend({cfg:s.extend(),init:function(e){this.cfg=this.cfg.extend(e),this.reset()},reset:function(){d.reset.call(this),this._doReset()},update:function(e){return this._append(e),this._process(),this},finalize:function(e){return e&&this._append(e),this._doFinalize()},blockSize:16,_createHelper:function(e){return function(t,i){return new e.init(i).finalize(t)}},_createHmacHelper:function(e){return function(t,i){return new c.HMAC.init(e,i).finalize(t)}}});var c=i.algo={};return i}(Math),n=n||function(e,t){var i={},n=i.lib={},r=function(){},s=n.Base={extend:function(e){r.prototype=this;var t=new r;return e&&t.mixIn(e),t.hasOwnProperty("init")||(t.init=function(){t.$super.init.apply(this,arguments)}),t.init.prototype=t,t.$super=this,t},create:function(){var e=this.extend();return e.init.apply(e,arguments),e},init:function(){},mixIn:function(e){for(var t in e)e.hasOwnProperty(t)&&(this[t]=e[t]);e.hasOwnProperty("toString")&&(this.toString=e.toString)},clone:function(){return this.init.prototype.extend(this)}},a=n.WordArray=s.extend({init:function(e,t){e=this.words=e||[],this.sigBytes=void 0!=t?t:4*e.length},toString:function(e){return(e||u).stringify(this)},concat:function(e){var t=this.words,i=e.words,n=this.sigBytes;if(e=e.sigBytes,this.clamp(),n%4)for(var r=0;r<e;r++)t[n+r>>>2]|=(i[r>>>2]>>>24-r%4*8&255)<<24-(n+r)%4*8;else if(65535<i.length)for(r=0;r<e;r+=4)t[n+r>>>2]=i[r>>>2];else t.push.apply(t,i);return this.sigBytes+=e,this},clamp:function(){var t=this.words,i=this.sigBytes;t[i>>>2]&=4294967295<<32-i%4*8,t.length=e.ceil(i/4)},clone:function(){var e=s.clone.call(this);return e.words=this.words.slice(0),e},random:function(t){for(var i=[],n=0;n<t;n+=4)i.push(4294967296*e.random()|0);return new a.init(i,t)}}),o=i.enc={},u=o.Hex={stringify:function(e){var t=e.words;e=e.sigBytes;for(var i=[],n=0;n<e;n++){var r=t[n>>>2]>>>24-n%4*8&255;i.push((r>>>4).toString(16)),i.push((15&r).toString(16))}return i.join("")},parse:function(e){for(var t=e.length,i=[],n=0;n<t;n+=2)i[n>>>3]|=parseInt(e.substr(n,2),16)<<24-n%8*4;return new a.init(i,t/2)}},l=o.Latin1={stringify:function(e){var t=e.words;e=e.sigBytes;for(var i=[],n=0;n<e;n++)i.push(String.fromCharCode(t[n>>>2]>>>24-n%4*8&255));return i.join("")},parse:function(e){for(var t=e.length,i=[],n=0;n<t;n++)i[n>>>2]|=(255&e.charCodeAt(n))<<24-n%4*8;return new a.init(i,t)}},h=o.Utf8={stringify:function(e){try{return decodeURIComponent(escape(l.stringify(e)))}catch(e){throw Error("Malformed UTF-8 data")}},parse:function(e){return l.parse(unescape(encodeURIComponent(e)))}},d=n.BufferedBlockAlgorithm=s.extend({reset:function(){this._data=new a.init,this._nDataBytes=0},_append:function(e){"string"==typeof e&&(e=h.parse(e)),this._data.concat(e),this._nDataBytes+=e.sigBytes},_process:function(t){var i=this._data,n=i.words,r=i.sigBytes,s=this.blockSize,o=r/(4*s),o=t?e.ceil(o):e.max((0|o)-this._minBufferSize,0);if(t=o*s,r=e.min(4*t,r),t){for(var u=0;u<t;u+=s)this._doProcessBlock(n,u);u=n.splice(0,t),i.sigBytes-=r}return new a.init(u,r)},clone:function(){var e=s.clone.call(this);return e._data=this._data.clone(),e},_minBufferSize:0});n.Hasher=d.extend({cfg:s.extend(),init:function(e){this.cfg=this.cfg.extend(e),this.reset()},reset:function(){d.reset.call(this),this._doReset()},update:function(e){return this._append(e),this._process(),this},finalize:function(e){return e&&this._append(e),this._doFinalize()},blockSize:16,_createHelper:function(e){return function(t,i){return new e.init(i).finalize(t)}},_createHmacHelper:function(e){return function(t,i){return new c.HMAC.init(e,i).finalize(t)}}});var c=i.algo={};return i}(Math);!function(){var e=n,t=e.lib.WordArray;e.enc.Base64={stringify:function(e){var t=e.words,i=e.sigBytes,n=this._map;e.clamp(),e=[];for(var r=0;r<i;r+=3)for(var s=(t[r>>>2]>>>24-r%4*8&255)<<16|(t[r+1>>>2]>>>24-(r+1)%4*8&255)<<8|t[r+2>>>2]>>>24-(r+2)%4*8&255,a=0;4>a&&r+.75*a<i;a++)e.push(n.charAt(s>>>6*(3-a)&63));if(t=n.charAt(64))for(;e.length%4;)e.push(t);return e.join("")},parse:function(e){var i=e.length,n=this._map,r=n.charAt(64);r&&-1!=(r=e.indexOf(r))&&(i=r);for(var r=[],s=0,a=0;a<i;a++)if(a%4){var o=n.indexOf(e.charAt(a-1))<<a%4*2,u=n.indexOf(e.charAt(a))>>>6-a%4*2;r[s>>>2]|=(o|u)<<24-s%4*8,s++}return t.create(r,s)},_map:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="}}(),function(e){function t(e,t,i,n,r,s,a){return((e=e+(t&i|~t&n)+r+a)<<s|e>>>32-s)+t}function i(e,t,i,n,r,s,a){return((e=e+(t&n|i&~n)+r+a)<<s|e>>>32-s)+t}function r(e,t,i,n,r,s,a){return((e=e+(t^i^n)+r+a)<<s|e>>>32-s)+t}function s(e,t,i,n,r,s,a){return((e=e+(i^(t|~n))+r+a)<<s|e>>>32-s)+t}for(var a=n,o=a.lib,u=o.WordArray,l=o.Hasher,o=a.algo,h=[],d=0;64>d;d++)h[d]=4294967296*e.abs(e.sin(d+1))|0;o=o.MD5=l.extend({_doReset:function(){this._hash=new u.init([1732584193,4023233417,2562383102,271733878])},_doProcessBlock:function(e,n){for(var a=0;16>a;a++){var o=n+a,u=e[o];e[o]=16711935&(u<<8|u>>>24)|4278255360&(u<<24|u>>>8)}var a=this._hash.words,o=e[n+0],u=e[n+1],l=e[n+2],d=e[n+3],c=e[n+4],f=e[n+5],_=e[n+6],p=e[n+7],m=e[n+8],v=e[n+9],g=e[n+10],y=e[n+11],b=e[n+12],E=e[n+13],S=e[n+14],k=e[n+15],w=a[0],L=a[1],R=a[2],A=a[3],w=t(w,L,R,A,o,7,h[0]),A=t(A,w,L,R,u,12,h[1]),R=t(R,A,w,L,l,17,h[2]),L=t(L,R,A,w,d,22,h[3]),w=t(w,L,R,A,c,7,h[4]),A=t(A,w,L,R,f,12,h[5]),R=t(R,A,w,L,_,17,h[6]),L=t(L,R,A,w,p,22,h[7]),w=t(w,L,R,A,m,7,h[8]),A=t(A,w,L,R,v,12,h[9]),R=t(R,A,w,L,g,17,h[10]),L=t(L,R,A,w,y,22,h[11]),w=t(w,L,R,A,b,7,h[12]),A=t(A,w,L,R,E,12,h[13]),R=t(R,A,w,L,S,17,h[14]),L=t(L,R,A,w,k,22,h[15]),w=i(w,L,R,A,u,5,h[16]),A=i(A,w,L,R,_,9,h[17]),R=i(R,A,w,L,y,14,h[18]),L=i(L,R,A,w,o,20,h[19]),w=i(w,L,R,A,f,5,h[20]),A=i(A,w,L,R,g,9,h[21]),R=i(R,A,w,L,k,14,h[22]),L=i(L,R,A,w,c,20,h[23]),w=i(w,L,R,A,v,5,h[24]),A=i(A,w,L,R,S,9,h[25]),R=i(R,A,w,L,d,14,h[26]),L=i(L,R,A,w,m,20,h[27]),w=i(w,L,R,A,E,5,h[28]),A=i(A,w,L,R,l,9,h[29]),R=i(R,A,w,L,p,14,h[30]),L=i(L,R,A,w,b,20,h[31]),w=r(w,L,R,A,f,4,h[32]),A=r(A,w,L,R,m,11,h[33]),R=r(R,A,w,L,y,16,h[34]),L=r(L,R,A,w,S,23,h[35]),w=r(w,L,R,A,u,4,h[36]),A=r(A,w,L,R,c,11,h[37]),R=r(R,A,w,L,p,16,h[38]),L=r(L,R,A,w,g,23,h[39]),w=r(w,L,R,A,E,4,h[40]),A=r(A,w,L,R,o,11,h[41]),R=r(R,A,w,L,d,16,h[42]),L=r(L,R,A,w,_,23,h[43]),w=r(w,L,R,A,v,4,h[44]),A=r(A,w,L,R,b,11,h[45]),R=r(R,A,w,L,k,16,h[46]),L=r(L,R,A,w,l,23,h[47]),w=s(w,L,R,A,o,6,h[48]),A=s(A,w,L,R,p,10,h[49]),R=s(R,A,w,L,S,15,h[50]),L=s(L,R,A,w,f,21,h[51]),w=s(w,L,R,A,b,6,h[52]),A=s(A,w,L,R,d,10,h[53]),R=s(R,A,w,L,g,15,h[54]),L=s(L,R,A,w,u,21,h[55]),w=s(w,L,R,A,m,6,h[56]),A=s(A,w,L,R,k,10,h[57]),R=s(R,A,w,L,_,15,h[58]),L=s(L,R,A,w,E,21,h[59]),w=s(w,L,R,A,c,6,h[60]),A=s(A,w,L,R,y,10,h[61]),R=s(R,A,w,L,l,15,h[62]),L=s(L,R,A,w,v,21,h[63]);a[0]=a[0]+w|0,a[1]=a[1]+L|0,a[2]=a[2]+R|0,a[3]=a[3]+A|0},_doFinalize:function(){var t=this._data,i=t.words,n=8*this._nDataBytes,r=8*t.sigBytes;i[r>>>5]|=128<<24-r%32;var s=e.floor(n/4294967296);for(i[15+(r+64>>>9<<4)]=16711935&(s<<8|s>>>24)|4278255360&(s<<24|s>>>8),i[14+(r+64>>>9<<4)]=16711935&(n<<8|n>>>24)|4278255360&(n<<24|n>>>8),t.sigBytes=4*(i.length+1),this._process(),t=this._hash,i=t.words,n=0;4>n;n++)r=i[n],i[n]=16711935&(r<<8|r>>>24)|4278255360&(r<<24|r>>>8);return t},clone:function(){var e=l.clone.call(this);return e._hash=this._hash.clone(),e}}),a.MD5=l._createHelper(o),a.HmacMD5=l._createHmacHelper(o)}(Math),function(){var e=n,t=e.lib,i=t.Base,r=t.WordArray,t=e.algo,s=t.EvpKDF=i.extend({cfg:i.extend({keySize:4,hasher:t.MD5,iterations:1}),init:function(e){this.cfg=this.cfg.extend(e)},compute:function(e,t){for(var i=this.cfg,n=i.hasher.create(),s=r.create(),a=s.words,o=i.keySize,i=i.iterations;a.length<o;){u&&n.update(u);var u=n.update(e).finalize(t);n.reset();for(var l=1;l<i;l++)u=n.finalize(u),n.reset();s.concat(u)}return s.sigBytes=4*o,s}});e.EvpKDF=function(e,t,i){return s.create(i).compute(e,t)}}(),n.lib.Cipher||function(e){var t=n,i=t.lib,r=i.Base,s=i.WordArray,a=i.BufferedBlockAlgorithm,o=t.enc.Base64,u=t.algo.EvpKDF,l=i.Cipher=a.extend({cfg:r.extend(),createEncryptor:function(e,t){return this.create(this._ENC_XFORM_MODE,e,t)},createDecryptor:function(e,t){return this.create(this._DEC_XFORM_MODE,e,t)},init:function(e,t,i){this.cfg=this.cfg.extend(i),this._xformMode=e,this._key=t,this.reset()},reset:function(){a.reset.call(this),this._doReset()},process:function(e){return this._append(e),this._process()},finalize:function(e){return e&&this._append(e),this._doFinalize()},keySize:4,ivSize:4,_ENC_XFORM_MODE:1,_DEC_XFORM_MODE:2,_createHelper:function(e){return{encrypt:function(t,i,n){return("string"==typeof i?p:_).encrypt(e,t,i,n)},decrypt:function(t,i,n){return("string"==typeof i?p:_).decrypt(e,t,i,n)}}}});i.StreamCipher=l.extend({_doFinalize:function(){return this._process(!0)},blockSize:1});var h=t.mode={},d=function(e,t,i){var n=this._iv;n?this._iv=void 0:n=this._prevBlock;for(var r=0;r<i;r++)e[t+r]^=n[r]},c=(i.BlockCipherMode=r.extend({createEncryptor:function(e,t){return this.Encryptor.create(e,t)},createDecryptor:function(e,t){return this.Decryptor.create(e,t)},init:function(e,t){this._cipher=e,this._iv=t}})).extend();c.Encryptor=c.extend({processBlock:function(e,t){var i=this._cipher,n=i.blockSize;d.call(this,e,t,n),i.encryptBlock(e,t),this._prevBlock=e.slice(t,t+n)}}),c.Decryptor=c.extend({processBlock:function(e,t){var i=this._cipher,n=i.blockSize,r=e.slice(t,t+n);i.decryptBlock(e,t),d.call(this,e,t,n),this._prevBlock=r}}),h=h.CBC=c,c=(t.pad={}).Pkcs7={pad:function(e,t){for(var i=4*t,i=i-e.sigBytes%i,n=i<<24|i<<16|i<<8|i,r=[],a=0;a<i;a+=4)r.push(n);i=s.create(r,i),e.concat(i)},unpad:function(e){e.sigBytes-=255&e.words[e.sigBytes-1>>>2]}},i.BlockCipher=l.extend({cfg:l.cfg.extend({mode:h,padding:c}),reset:function(){l.reset.call(this);var e=this.cfg,t=e.iv,e=e.mode;if(this._xformMode==this._ENC_XFORM_MODE)var i=e.createEncryptor;else i=e.createDecryptor,this._minBufferSize=1;this._mode=i.call(e,this,t&&t.words)},_doProcessBlock:function(e,t){this._mode.processBlock(e,t)},_doFinalize:function(){var e=this.cfg.padding;if(this._xformMode==this._ENC_XFORM_MODE){e.pad(this._data,this.blockSize);var t=this._process(!0)}else t=this._process(!0),e.unpad(t);return t},blockSize:4});var f=i.CipherParams=r.extend({init:function(e){this.mixIn(e)},toString:function(e){return(e||this.formatter).stringify(this)}}),h=(t.format={}).OpenSSL={stringify:function(e){var t=e.ciphertext;return e=e.salt,(e?s.create([1398893684,1701076831]).concat(e).concat(t):t).toString(o)},parse:function(e){e=o.parse(e);var t=e.words;if(1398893684==t[0]&&1701076831==t[1]){var i=s.create(t.slice(2,4));t.splice(0,4),e.sigBytes-=16}return f.create({ciphertext:e,salt:i})}},_=i.SerializableCipher=r.extend({cfg:r.extend({format:h}),encrypt:function(e,t,i,n){n=this.cfg.extend(n);var r=e.createEncryptor(i,n);return t=r.finalize(t),r=r.cfg,f.create({ciphertext:t,key:i,iv:r.iv,algorithm:e,mode:r.mode,padding:r.padding,blockSize:e.blockSize,formatter:n.format})},decrypt:function(e,t,i,n){return n=this.cfg.extend(n),t=this._parse(t,n.format),e.createDecryptor(i,n).finalize(t.ciphertext)},_parse:function(e,t){return"string"==typeof e?t.parse(e,this):e}}),t=(t.kdf={}).OpenSSL={execute:function(e,t,i,n){return n||(n=s.random(8)),e=u.create({keySize:t+i}).compute(e,n),i=s.create(e.words.slice(t),4*i),e.sigBytes=4*t,f.create({key:e,iv:i,salt:n})}},p=i.PasswordBasedCipher=_.extend({cfg:_.cfg.extend({kdf:t}),encrypt:function(e,t,i,n){return n=this.cfg.extend(n),i=n.kdf.execute(i,e.keySize,e.ivSize),n.iv=i.iv,e=_.encrypt.call(this,e,t,i.key,n),e.mixIn(i),e},decrypt:function(e,t,i,n){return n=this.cfg.extend(n),t=this._parse(t,n.format),i=n.kdf.execute(i,e.keySize,e.ivSize,t.salt),n.iv=i.iv,_.decrypt.call(this,e,t,i.key,n)}})}(),function(){for(var e=n,t=e.lib.BlockCipher,i=e.algo,r=[],s=[],a=[],o=[],u=[],l=[],h=[],d=[],c=[],f=[],_=[],p=0;256>p;p++)_[p]=128>p?p<<1:p<<1^283;for(var m=0,v=0,p=0;256>p;p++){var g=v^v<<1^v<<2^v<<3^v<<4,g=g>>>8^255&g^99;r[m]=g,s[g]=m;var y=_[m],b=_[y],E=_[b],S=257*_[g]^16843008*g
;a[m]=S<<24|S>>>8,o[m]=S<<16|S>>>16,u[m]=S<<8|S>>>24,l[m]=S,S=16843009*E^65537*b^257*y^16843008*m,h[g]=S<<24|S>>>8,d[g]=S<<16|S>>>16,c[g]=S<<8|S>>>24,f[g]=S,m?(m=y^_[_[_[E^y]]],v^=_[_[v]]):m=v=1}var k=[0,1,2,4,8,16,32,64,128,27,54],i=i.AES=t.extend({_doReset:function(){for(var e=this._key,t=e.words,i=e.sigBytes/4,e=4*((this._nRounds=i+6)+1),n=this._keySchedule=[],s=0;s<e;s++)if(s<i)n[s]=t[s];else{var a=n[s-1];s%i?6<i&&4==s%i&&(a=r[a>>>24]<<24|r[a>>>16&255]<<16|r[a>>>8&255]<<8|r[255&a]):(a=a<<8|a>>>24,a=r[a>>>24]<<24|r[a>>>16&255]<<16|r[a>>>8&255]<<8|r[255&a],a^=k[s/i|0]<<24),n[s]=n[s-i]^a}for(t=this._invKeySchedule=[],i=0;i<e;i++)s=e-i,a=i%4?n[s]:n[s-4],t[i]=4>i||4>=s?a:h[r[a>>>24]]^d[r[a>>>16&255]]^c[r[a>>>8&255]]^f[r[255&a]]},encryptBlock:function(e,t){this._doCryptBlock(e,t,this._keySchedule,a,o,u,l,r)},decryptBlock:function(e,t){var i=e[t+1];e[t+1]=e[t+3],e[t+3]=i,this._doCryptBlock(e,t,this._invKeySchedule,h,d,c,f,s),i=e[t+1],e[t+1]=e[t+3],e[t+3]=i},_doCryptBlock:function(e,t,i,n,r,s,a,o){for(var u=this._nRounds,l=e[t]^i[0],h=e[t+1]^i[1],d=e[t+2]^i[2],c=e[t+3]^i[3],f=4,_=1;_<u;_++)var p=n[l>>>24]^r[h>>>16&255]^s[d>>>8&255]^a[255&c]^i[f++],m=n[h>>>24]^r[d>>>16&255]^s[c>>>8&255]^a[255&l]^i[f++],v=n[d>>>24]^r[c>>>16&255]^s[l>>>8&255]^a[255&h]^i[f++],c=n[c>>>24]^r[l>>>16&255]^s[h>>>8&255]^a[255&d]^i[f++],l=p,h=m,d=v;p=(o[l>>>24]<<24|o[h>>>16&255]<<16|o[d>>>8&255]<<8|o[255&c])^i[f++],m=(o[h>>>24]<<24|o[d>>>16&255]<<16|o[c>>>8&255]<<8|o[255&l])^i[f++],v=(o[d>>>24]<<24|o[c>>>16&255]<<16|o[l>>>8&255]<<8|o[255&h])^i[f++],c=(o[c>>>24]<<24|o[l>>>16&255]<<16|o[h>>>8&255]<<8|o[255&d])^i[f++],e[t]=p,e[t+1]=m,e[t+2]=v,e[t+3]=c},keySize:8});e.AES=t._createHelper(i)}();var n=n||function(e,t){var i={},n=i.lib={},r=function(){},s=n.Base={extend:function(e){r.prototype=this;var t=new r;return e&&t.mixIn(e),t.hasOwnProperty("init")||(t.init=function(){t.$super.init.apply(this,arguments)}),t.init.prototype=t,t.$super=this,t},create:function(){var e=this.extend();return e.init.apply(e,arguments),e},init:function(){},mixIn:function(e){for(var t in e)e.hasOwnProperty(t)&&(this[t]=e[t]);e.hasOwnProperty("toString")&&(this.toString=e.toString)},clone:function(){return this.init.prototype.extend(this)}},a=n.WordArray=s.extend({init:function(e,t){e=this.words=e||[],this.sigBytes=void 0!=t?t:4*e.length},toString:function(e){return(e||u).stringify(this)},concat:function(e){var t=this.words,i=e.words,n=this.sigBytes;if(e=e.sigBytes,this.clamp(),n%4)for(var r=0;r<e;r++)t[n+r>>>2]|=(i[r>>>2]>>>24-r%4*8&255)<<24-(n+r)%4*8;else if(65535<i.length)for(r=0;r<e;r+=4)t[n+r>>>2]=i[r>>>2];else t.push.apply(t,i);return this.sigBytes+=e,this},clamp:function(){var t=this.words,i=this.sigBytes;t[i>>>2]&=4294967295<<32-i%4*8,t.length=e.ceil(i/4)},clone:function(){var e=s.clone.call(this);return e.words=this.words.slice(0),e},random:function(t){for(var i=[],n=0;n<t;n+=4)i.push(4294967296*e.random()|0);return new a.init(i,t)}}),o=i.enc={},u=o.Hex={stringify:function(e){var t=e.words;e=e.sigBytes;for(var i=[],n=0;n<e;n++){var r=t[n>>>2]>>>24-n%4*8&255;i.push((r>>>4).toString(16)),i.push((15&r).toString(16))}return i.join("")},parse:function(e){for(var t=e.length,i=[],n=0;n<t;n+=2)i[n>>>3]|=parseInt(e.substr(n,2),16)<<24-n%8*4;return new a.init(i,t/2)}},l=o.Latin1={stringify:function(e){var t=e.words;e=e.sigBytes;for(var i=[],n=0;n<e;n++)i.push(String.fromCharCode(t[n>>>2]>>>24-n%4*8&255));return i.join("")},parse:function(e){for(var t=e.length,i=[],n=0;n<t;n++)i[n>>>2]|=(255&e.charCodeAt(n))<<24-n%4*8;return new a.init(i,t)}},h=o.Utf8={stringify:function(e){try{return decodeURIComponent(escape(l.stringify(e)))}catch(e){throw Error("Malformed UTF-8 data")}},parse:function(e){return l.parse(unescape(encodeURIComponent(e)))}},d=n.BufferedBlockAlgorithm=s.extend({reset:function(){this._data=new a.init,this._nDataBytes=0},_append:function(e){"string"==typeof e&&(e=h.parse(e)),this._data.concat(e),this._nDataBytes+=e.sigBytes},_process:function(t){var i=this._data,n=i.words,r=i.sigBytes,s=this.blockSize,o=r/(4*s),o=t?e.ceil(o):e.max((0|o)-this._minBufferSize,0);if(t=o*s,r=e.min(4*t,r),t){for(var u=0;u<t;u+=s)this._doProcessBlock(n,u);u=n.splice(0,t),i.sigBytes-=r}return new a.init(u,r)},clone:function(){var e=s.clone.call(this);return e._data=this._data.clone(),e},_minBufferSize:0});n.Hasher=d.extend({cfg:s.extend(),init:function(e){this.cfg=this.cfg.extend(e),this.reset()},reset:function(){d.reset.call(this),this._doReset()},update:function(e){return this._append(e),this._process(),this},finalize:function(e){return e&&this._append(e),this._doFinalize()},blockSize:16,_createHelper:function(e){return function(t,i){return new e.init(i).finalize(t)}},_createHmacHelper:function(e){return function(t,i){return new c.HMAC.init(e,i).finalize(t)}}});var c=i.algo={};return i}(Math);!function(){var e=n,t=e.lib.WordArray;e.enc.Base64={stringify:function(e){var t=e.words,i=e.sigBytes,n=this._map;e.clamp(),e=[];for(var r=0;r<i;r+=3)for(var s=(t[r>>>2]>>>24-r%4*8&255)<<16|(t[r+1>>>2]>>>24-(r+1)%4*8&255)<<8|t[r+2>>>2]>>>24-(r+2)%4*8&255,a=0;4>a&&r+.75*a<i;a++)e.push(n.charAt(s>>>6*(3-a)&63));if(t=n.charAt(64))for(;e.length%4;)e.push(t);return e.join("")},parse:function(e){var i=e.length,n=this._map,r=n.charAt(64);r&&-1!=(r=e.indexOf(r))&&(i=r);for(var r=[],s=0,a=0;a<i;a++)if(a%4){var o=n.indexOf(e.charAt(a-1))<<a%4*2,u=n.indexOf(e.charAt(a))>>>6-a%4*2;r[s>>>2]|=(o|u)<<24-s%4*8,s++}return t.create(r,s)},_map:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="}}(),function(e){function t(e,t,i,n,r,s,a){return((e=e+(t&i|~t&n)+r+a)<<s|e>>>32-s)+t}function i(e,t,i,n,r,s,a){return((e=e+(t&n|i&~n)+r+a)<<s|e>>>32-s)+t}function r(e,t,i,n,r,s,a){return((e=e+(t^i^n)+r+a)<<s|e>>>32-s)+t}function s(e,t,i,n,r,s,a){return((e=e+(i^(t|~n))+r+a)<<s|e>>>32-s)+t}for(var a=n,o=a.lib,u=o.WordArray,l=o.Hasher,o=a.algo,h=[],d=0;64>d;d++)h[d]=4294967296*e.abs(e.sin(d+1))|0;o=o.MD5=l.extend({_doReset:function(){this._hash=new u.init([1732584193,4023233417,2562383102,271733878])},_doProcessBlock:function(e,n){for(var a=0;16>a;a++){var o=n+a,u=e[o];e[o]=16711935&(u<<8|u>>>24)|4278255360&(u<<24|u>>>8)}var a=this._hash.words,o=e[n+0],u=e[n+1],l=e[n+2],d=e[n+3],c=e[n+4],f=e[n+5],_=e[n+6],p=e[n+7],m=e[n+8],v=e[n+9],g=e[n+10],y=e[n+11],b=e[n+12],E=e[n+13],S=e[n+14],k=e[n+15],w=a[0],L=a[1],R=a[2],A=a[3],w=t(w,L,R,A,o,7,h[0]),A=t(A,w,L,R,u,12,h[1]),R=t(R,A,w,L,l,17,h[2]),L=t(L,R,A,w,d,22,h[3]),w=t(w,L,R,A,c,7,h[4]),A=t(A,w,L,R,f,12,h[5]),R=t(R,A,w,L,_,17,h[6]),L=t(L,R,A,w,p,22,h[7]),w=t(w,L,R,A,m,7,h[8]),A=t(A,w,L,R,v,12,h[9]),R=t(R,A,w,L,g,17,h[10]),L=t(L,R,A,w,y,22,h[11]),w=t(w,L,R,A,b,7,h[12]),A=t(A,w,L,R,E,12,h[13]),R=t(R,A,w,L,S,17,h[14]),L=t(L,R,A,w,k,22,h[15]),w=i(w,L,R,A,u,5,h[16]),A=i(A,w,L,R,_,9,h[17]),R=i(R,A,w,L,y,14,h[18]),L=i(L,R,A,w,o,20,h[19]),w=i(w,L,R,A,f,5,h[20]),A=i(A,w,L,R,g,9,h[21]),R=i(R,A,w,L,k,14,h[22]),L=i(L,R,A,w,c,20,h[23]),w=i(w,L,R,A,v,5,h[24]),A=i(A,w,L,R,S,9,h[25]),R=i(R,A,w,L,d,14,h[26]),L=i(L,R,A,w,m,20,h[27]),w=i(w,L,R,A,E,5,h[28]),A=i(A,w,L,R,l,9,h[29]),R=i(R,A,w,L,p,14,h[30]),L=i(L,R,A,w,b,20,h[31]),w=r(w,L,R,A,f,4,h[32]),A=r(A,w,L,R,m,11,h[33]),R=r(R,A,w,L,y,16,h[34]),L=r(L,R,A,w,S,23,h[35]),w=r(w,L,R,A,u,4,h[36]),A=r(A,w,L,R,c,11,h[37]),R=r(R,A,w,L,p,16,h[38]),L=r(L,R,A,w,g,23,h[39]),w=r(w,L,R,A,E,4,h[40]),A=r(A,w,L,R,o,11,h[41]),R=r(R,A,w,L,d,16,h[42]),L=r(L,R,A,w,_,23,h[43]),w=r(w,L,R,A,v,4,h[44]),A=r(A,w,L,R,b,11,h[45]),R=r(R,A,w,L,k,16,h[46]),L=r(L,R,A,w,l,23,h[47]),w=s(w,L,R,A,o,6,h[48]),A=s(A,w,L,R,p,10,h[49]),R=s(R,A,w,L,S,15,h[50]),L=s(L,R,A,w,f,21,h[51]),w=s(w,L,R,A,b,6,h[52]),A=s(A,w,L,R,d,10,h[53]),R=s(R,A,w,L,g,15,h[54]),L=s(L,R,A,w,u,21,h[55]),w=s(w,L,R,A,m,6,h[56]),A=s(A,w,L,R,k,10,h[57]),R=s(R,A,w,L,_,15,h[58]),L=s(L,R,A,w,E,21,h[59]),w=s(w,L,R,A,c,6,h[60]),A=s(A,w,L,R,y,10,h[61]),R=s(R,A,w,L,l,15,h[62]),L=s(L,R,A,w,v,21,h[63]);a[0]=a[0]+w|0,a[1]=a[1]+L|0,a[2]=a[2]+R|0,a[3]=a[3]+A|0},_doFinalize:function(){var t=this._data,i=t.words,n=8*this._nDataBytes,r=8*t.sigBytes;i[r>>>5]|=128<<24-r%32;var s=e.floor(n/4294967296);for(i[15+(r+64>>>9<<4)]=16711935&(s<<8|s>>>24)|4278255360&(s<<24|s>>>8),i[14+(r+64>>>9<<4)]=16711935&(n<<8|n>>>24)|4278255360&(n<<24|n>>>8),t.sigBytes=4*(i.length+1),this._process(),t=this._hash,i=t.words,n=0;4>n;n++)r=i[n],i[n]=16711935&(r<<8|r>>>24)|4278255360&(r<<24|r>>>8);return t},clone:function(){var e=l.clone.call(this);return e._hash=this._hash.clone(),e}}),a.MD5=l._createHelper(o),a.HmacMD5=l._createHmacHelper(o)}(Math),function(){var e=n,t=e.lib,i=t.Base,r=t.WordArray,t=e.algo,s=t.EvpKDF=i.extend({cfg:i.extend({keySize:4,hasher:t.MD5,iterations:1}),init:function(e){this.cfg=this.cfg.extend(e)},compute:function(e,t){for(var i=this.cfg,n=i.hasher.create(),s=r.create(),a=s.words,o=i.keySize,i=i.iterations;a.length<o;){u&&n.update(u);var u=n.update(e).finalize(t);n.reset();for(var l=1;l<i;l++)u=n.finalize(u),n.reset();s.concat(u)}return s.sigBytes=4*o,s}});e.EvpKDF=function(e,t,i){return s.create(i).compute(e,t)}}(),n.lib.Cipher||function(e){var t=n,i=t.lib,r=i.Base,s=i.WordArray,a=i.BufferedBlockAlgorithm,o=t.enc.Base64,u=t.algo.EvpKDF,l=i.Cipher=a.extend({cfg:r.extend(),createEncryptor:function(e,t){return this.create(this._ENC_XFORM_MODE,e,t)},createDecryptor:function(e,t){return this.create(this._DEC_XFORM_MODE,e,t)},init:function(e,t,i){this.cfg=this.cfg.extend(i),this._xformMode=e,this._key=t,this.reset()},reset:function(){a.reset.call(this),this._doReset()},process:function(e){return this._append(e),this._process()},finalize:function(e){return e&&this._append(e),this._doFinalize()},keySize:4,ivSize:4,_ENC_XFORM_MODE:1,_DEC_XFORM_MODE:2,_createHelper:function(e){return{encrypt:function(t,i,n){return("string"==typeof i?p:_).encrypt(e,t,i,n)},decrypt:function(t,i,n){return("string"==typeof i?p:_).decrypt(e,t,i,n)}}}});i.StreamCipher=l.extend({_doFinalize:function(){return this._process(!0)},blockSize:1});var h=t.mode={},d=function(e,t,i){var n=this._iv;n?this._iv=void 0:n=this._prevBlock;for(var r=0;r<i;r++)e[t+r]^=n[r]},c=(i.BlockCipherMode=r.extend({createEncryptor:function(e,t){return this.Encryptor.create(e,t)},createDecryptor:function(e,t){return this.Decryptor.create(e,t)},init:function(e,t){this._cipher=e,this._iv=t}})).extend();c.Encryptor=c.extend({processBlock:function(e,t){var i=this._cipher,n=i.blockSize;d.call(this,e,t,n),i.encryptBlock(e,t),this._prevBlock=e.slice(t,t+n)}}),c.Decryptor=c.extend({processBlock:function(e,t){var i=this._cipher,n=i.blockSize,r=e.slice(t,t+n);i.decryptBlock(e,t),d.call(this,e,t,n),this._prevBlock=r}}),h=h.CBC=c,c=(t.pad={}).Pkcs7={pad:function(e,t){for(var i=4*t,i=i-e.sigBytes%i,n=i<<24|i<<16|i<<8|i,r=[],a=0;a<i;a+=4)r.push(n);i=s.create(r,i),e.concat(i)},unpad:function(e){e.sigBytes-=255&e.words[e.sigBytes-1>>>2]}},i.BlockCipher=l.extend({cfg:l.cfg.extend({mode:h,padding:c}),reset:function(){l.reset.call(this);var e=this.cfg,t=e.iv,e=e.mode;if(this._xformMode==this._ENC_XFORM_MODE)var i=e.createEncryptor;else i=e.createDecryptor,this._minBufferSize=1;this._mode=i.call(e,this,t&&t.words)},_doProcessBlock:function(e,t){this._mode.processBlock(e,t)},_doFinalize:function(){var e=this.cfg.padding;if(this._xformMode==this._ENC_XFORM_MODE){e.pad(this._data,this.blockSize);var t=this._process(!0)}else t=this._process(!0),e.unpad(t);return t},blockSize:4});var f=i.CipherParams=r.extend({init:function(e){this.mixIn(e)},toString:function(e){return(e||this.formatter).stringify(this)}}),h=(t.format={}).OpenSSL={stringify:function(e){var t=e.ciphertext;return e=e.salt,(e?s.create([1398893684,1701076831]).concat(e).concat(t):t).toString(o)},parse:function(e){e=o.parse(e);var t=e.words;if(1398893684==t[0]&&1701076831==t[1]){var i=s.create(t.slice(2,4));t.splice(0,4),e.sigBytes-=16}return f.create({ciphertext:e,salt:i})}},_=i.SerializableCipher=r.extend({cfg:r.extend({format:h}),encrypt:function(e,t,i,n){n=this.cfg.extend(n);var r=e.createEncryptor(i,n);return t=r.finalize(t),r=r.cfg,f.create({ciphertext:t,key:i,iv:r.iv,algorithm:e,mode:r.mode,padding:r.padding,blockSize:e.blockSize,formatter:n.format})},decrypt:function(e,t,i,n){return n=this.cfg.extend(n),t=this._parse(t,n.format),e.createDecryptor(i,n).finalize(t.ciphertext)},_parse:function(e,t){return"string"==typeof e?t.parse(e,this):e}}),t=(t.kdf={}).OpenSSL={execute:function(e,t,i,n){return n||(n=s.random(8)),e=u.create({keySize:t+i}).compute(e,n),i=s.create(e.words.slice(t),4*i),e.sigBytes=4*t,f.create({key:e,iv:i,salt:n})}},p=i.PasswordBasedCipher=_.extend({cfg:_.cfg.extend({kdf:t}),encrypt:function(e,t,i,n){return n=this.cfg.extend(n),i=n.kdf.execute(i,e.keySize,e.ivSize),n.iv=i.iv,e=_.encrypt.call(this,e,t,i.key,n),e.mixIn(i),e},decrypt:function(e,t,i,n){return n=this.cfg.extend(n),t=this._parse(t,n.format),i=n.kdf.execute(i,e.keySize,e.ivSize,t.salt),n.iv=i.iv,_.decrypt.call(this,e,t,i.key,n)}})}(),function(){function e(){for(var e=this._S,t=this._i,i=this._j,n=0,r=0;4>r;r++){var t=(t+1)%256,i=(i+e[t])%256,s=e[t];e[t]=e[i],e[i]=s,n|=e[(e[t]+e[i])%256]<<24-8*r}return this._i=t,this._j=i,n}var t=n,i=t.lib.StreamCipher,r=t.algo,s=r.RC4=i.extend({_doReset:function(){for(var e=this._key,t=e.words,e=e.sigBytes,i=this._S=[],n=0;256>n;n++)i[n]=n;for(var r=n=0;256>n;n++){var s=n%e,r=(r+i[n]+(t[s>>>2]>>>24-s%4*8&255))%256,s=i[n];i[n]=i[r],i[r]=s}this._i=this._j=0},_doProcessBlock:function(t,i){t[i]^=e.call(this)},keySize:8,ivSize:0});t.RC4=i._createHelper(s),r=r.RC4Drop=s.extend({cfg:s.cfg.extend({drop:192}),_doReset:function(){s._doReset.call(this);for(var t=this.cfg.drop;0<t;t--)e.call(this)}}),t.RC4Drop=i._createHelper(r)}(),n.pad.ZeroPadding={pad:function(e,t){var i=4*t;e.clamp(),e.sigBytes+=i-(e.sigBytes%i||i)},unpad:function(e){for(var t=e.words,i=e.sigBytes-1;!(t[i>>>2]>>>24-i%4*8&255);)i--;e.sigBytes=i+1}};var n=n||function(e,t){var i={},n=i.lib={},r=function(){},s=n.Base={extend:function(e){r.prototype=this;var t=new r;return e&&t.mixIn(e),t.hasOwnProperty("init")||(t.init=function(){t.$super.init.apply(this,arguments)}),t.init.prototype=t,t.$super=this,t},create:function(){var e=this.extend();return e.init.apply(e,arguments),e},init:function(){},mixIn:function(e){for(var t in e)e.hasOwnProperty(t)&&(this[t]=e[t]);e.hasOwnProperty("toString")&&(this.toString=e.toString)},clone:function(){return this.init.prototype.extend(this)}},a=n.WordArray=s.extend({init:function(e,t){e=this.words=e||[],this.sigBytes=void 0!=t?t:4*e.length},toString:function(e){return(e||u).stringify(this)},concat:function(e){var t=this.words,i=e.words,n=this.sigBytes;if(e=e.sigBytes,this.clamp(),n%4)for(var r=0;r<e;r++)t[n+r>>>2]|=(i[r>>>2]>>>24-r%4*8&255)<<24-(n+r)%4*8;else if(65535<i.length)for(r=0;r<e;r+=4)t[n+r>>>2]=i[r>>>2];else t.push.apply(t,i);return this.sigBytes+=e,this},clamp:function(){var t=this.words,i=this.sigBytes;t[i>>>2]&=4294967295<<32-i%4*8,t.length=e.ceil(i/4)},clone:function(){var e=s.clone.call(this);return e.words=this.words.slice(0),e},random:function(t){for(var i=[],n=0;n<t;n+=4)i.push(4294967296*e.random()|0);return new a.init(i,t)}}),o=i.enc={},u=o.Hex={stringify:function(e){var t=e.words;e=e.sigBytes;for(var i=[],n=0;n<e;n++){var r=t[n>>>2]>>>24-n%4*8&255;i.push((r>>>4).toString(16)),i.push((15&r).toString(16))}return i.join("")},parse:function(e){for(var t=e.length,i=[],n=0;n<t;n+=2)i[n>>>3]|=parseInt(e.substr(n,2),16)<<24-n%8*4;return new a.init(i,t/2)}},l=o.Latin1={stringify:function(e){var t=e.words;e=e.sigBytes;for(var i=[],n=0;n<e;n++)i.push(String.fromCharCode(t[n>>>2]>>>24-n%4*8&255));return i.join("")},parse:function(e){for(var t=e.length,i=[],n=0;n<t;n++)i[n>>>2]|=(255&e.charCodeAt(n))<<24-n%4*8;return new a.init(i,t)}},h=o.Utf8={stringify:function(e){try{return decodeURIComponent(escape(l.stringify(e)))}catch(e){throw Error("Malformed UTF-8 data")}},parse:function(e){return l.parse(unescape(encodeURIComponent(e)))}},d=n.BufferedBlockAlgorithm=s.extend({reset:function(){this._data=new a.init,this._nDataBytes=0},_append:function(e){"string"==typeof e&&(e=h.parse(e)),this._data.concat(e),this._nDataBytes+=e.sigBytes},_process:function(t){var i=this._data,n=i.words,r=i.sigBytes,s=this.blockSize,o=r/(4*s),o=t?e.ceil(o):e.max((0|o)-this._minBufferSize,0);if(t=o*s,r=e.min(4*t,r),t){for(var u=0;u<t;u+=s)this._doProcessBlock(n,u);u=n.splice(0,t),i.sigBytes-=r}return new a.init(u,r)},clone:function(){var e=s.clone.call(this);return e._data=this._data.clone(),e},_minBufferSize:0});n.Hasher=d.extend({cfg:s.extend(),init:function(e){this.cfg=this.cfg.extend(e),this.reset()},reset:function(){d.reset.call(this),this._doReset()},update:function(e){return this._append(e),this._process(),this},finalize:function(e){return e&&this._append(e),this._doFinalize()},blockSize:16,_createHelper:function(e){return function(t,i){return new e.init(i).finalize(t)}},_createHmacHelper:function(e){return function(t,i){return new c.HMAC.init(e,i).finalize(t)}}});var c=i.algo={};return i}(Math);!function(e){function t(e,t,i,n,r,s,a){return((e=e+(t&i|~t&n)+r+a)<<s|e>>>32-s)+t}function i(e,t,i,n,r,s,a){return((e=e+(t&n|i&~n)+r+a)<<s|e>>>32-s)+t}function r(e,t,i,n,r,s,a){return((e=e+(t^i^n)+r+a)<<s|e>>>32-s)+t}function s(e,t,i,n,r,s,a){return((e=e+(i^(t|~n))+r+a)<<s|e>>>32-s)+t}for(var a=n,o=a.lib,u=o.WordArray,l=o.Hasher,o=a.algo,h=[],d=0;64>d;d++)h[d]=4294967296*e.abs(e.sin(d+1))|0;o=o.MD5=l.extend({_doReset:function(){this._hash=new u.init([1732584193,4023233417,2562383102,271733878])},_doProcessBlock:function(e,n){for(var a=0;16>a;a++){var o=n+a,u=e[o];e[o]=16711935&(u<<8|u>>>24)|4278255360&(u<<24|u>>>8)}var a=this._hash.words,o=e[n+0],u=e[n+1],l=e[n+2],d=e[n+3],c=e[n+4],f=e[n+5],_=e[n+6],p=e[n+7],m=e[n+8],v=e[n+9],g=e[n+10],y=e[n+11],b=e[n+12],E=e[n+13],S=e[n+14],k=e[n+15],w=a[0],L=a[1],R=a[2],A=a[3],w=t(w,L,R,A,o,7,h[0]),A=t(A,w,L,R,u,12,h[1]),R=t(R,A,w,L,l,17,h[2]),L=t(L,R,A,w,d,22,h[3]),w=t(w,L,R,A,c,7,h[4]),A=t(A,w,L,R,f,12,h[5]),R=t(R,A,w,L,_,17,h[6]),L=t(L,R,A,w,p,22,h[7]),w=t(w,L,R,A,m,7,h[8]),A=t(A,w,L,R,v,12,h[9]),R=t(R,A,w,L,g,17,h[10]),L=t(L,R,A,w,y,22,h[11]),w=t(w,L,R,A,b,7,h[12]),A=t(A,w,L,R,E,12,h[13]),R=t(R,A,w,L,S,17,h[14]),L=t(L,R,A,w,k,22,h[15]),w=i(w,L,R,A,u,5,h[16]),A=i(A,w,L,R,_,9,h[17]),R=i(R,A,w,L,y,14,h[18]),L=i(L,R,A,w,o,20,h[19]),w=i(w,L,R,A,f,5,h[20]),A=i(A,w,L,R,g,9,h[21]),R=i(R,A,w,L,k,14,h[22]),L=i(L,R,A,w,c,20,h[23]),w=i(w,L,R,A,v,5,h[24]),A=i(A,w,L,R,S,9,h[25]),R=i(R,A,w,L,d,14,h[26]),L=i(L,R,A,w,m,20,h[27]),w=i(w,L,R,A,E,5,h[28]),A=i(A,w,L,R,l,9,h[29]),R=i(R,A,w,L,p,14,h[30]),L=i(L,R,A,w,b,20,h[31]),w=r(w,L,R,A,f,4,h[32]),A=r(A,w,L,R,m,11,h[33]),R=r(R,A,w,L,y,16,h[34]),L=r(L,R,A,w,S,23,h[35]),w=r(w,L,R,A,u,4,h[36]),A=r(A,w,L,R,c,11,h[37]),R=r(R,A,w,L,p,16,h[38]),L=r(L,R,A,w,g,23,h[39]),w=r(w,L,R,A,E,4,h[40]),A=r(A,w,L,R,o,11,h[41]),R=r(R,A,w,L,d,16,h[42]),L=r(L,R,A,w,_,23,h[43]),w=r(w,L,R,A,v,4,h[44]),A=r(A,w,L,R,b,11,h[45]),R=r(R,A,w,L,k,16,h[46]),L=r(L,R,A,w,l,23,h[47]),w=s(w,L,R,A,o,6,h[48]),A=s(A,w,L,R,p,10,h[49]),R=s(R,A,w,L,S,15,h[50]),L=s(L,R,A,w,f,21,h[51]),w=s(w,L,R,A,b,6,h[52]),A=s(A,w,L,R,d,10,h[53]),R=s(R,A,w,L,g,15,h[54]),L=s(L,R,A,w,u,21,h[55]),w=s(w,L,R,A,m,6,h[56]),A=s(A,w,L,R,k,10,h[57]),R=s(R,A,w,L,_,15,h[58]),L=s(L,R,A,w,E,21,h[59]),w=s(w,L,R,A,c,6,h[60]),A=s(A,w,L,R,y,10,h[61]),R=s(R,A,w,L,l,15,h[62]),L=s(L,R,A,w,v,21,h[63]);a[0]=a[0]+w|0,a[1]=a[1]+L|0,a[2]=a[2]+R|0,a[3]=a[3]+A|0},_doFinalize:function(){var t=this._data,i=t.words,n=8*this._nDataBytes,r=8*t.sigBytes;i[r>>>5]|=128<<24-r%32;var s=e.floor(n/4294967296);for(i[15+(r+64>>>9<<4)]=16711935&(s<<8|s>>>24)|4278255360&(s<<24|s>>>8),i[14+(r+64>>>9<<4)]=16711935&(n<<8|n>>>24)|4278255360&(n<<24|n>>>8),t.sigBytes=4*(i.length+1),this._process(),t=this._hash,i=t.words,n=0;4>n;n++)r=i[n],i[n]=16711935&(r<<8|r>>>24)|4278255360&(r<<24|r>>>8);return t},clone:function(){var e=l.clone.call(this);return e._hash=this._hash.clone(),e}}),a.MD5=l._createHelper(o),a.HmacMD5=l._createHmacHelper(o)}(Math),n.enc.u8array={stringify:function(e){for(var t=e.words,i=e.sigBytes,n=new Uint8Array(i),r=0;r<i;r++){var s=t[r>>>2]>>>24-r%4*8&255;n[r]=s}return t=i=null,n},parse:function(e){for(var t=e.length,i=[],r=0;r<t;r++)i[r>>>2]|=(255&e[r])<<24-r%4*8;var s=n.lib.WordArray.create(i,t);return i=null,s}};var r={};r.generateUUID=function(){var e=(new Date).getTime();return"xxxxxxxx-xxxx4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(t){var i=(e+16*Math.random())%16|0;return e=Math.floor(e/16),("x"==t?i:3&i|8).toString(16)})},r.rc4=function(){this._skd=null,this._key=null,this._iv=null,this.init=function(e){if(this._skd=new Uint8Array(256),this._key=e,e.length<16)for(var t=e.length;t<16;t++)e+="0";else e.length>16&&(e=e.substring(0,16));var t,i,n=this._skd,r=0;for(t=0;t<256;t++)n[t]=t;for(t=0;t<256;t++)r=(r+n[t]+e.charCodeAt(t%e.length))%256,i=n[t],n[t]=n[r],n[r]=i},this.decrypt=function(e){var t,i,n,r=0,s=0,a=this._skd,o=new Uint8Array(e.length);for(n=0;n<o.length;n++)r=(r+1)%256,t=a[r],s=(s+t)%256,i=a[s],a[r]=i,a[s]=t,o[n]=e[n]^a[(t+i)%256];return o}},r.aes=function(){this.init=function(e,t){this._key=e,this._iv=t},this.decrypt=function(e){if(this._key&&this._iv){var t=this._key;if(t.length<16&&t.length>0)for(var i=t.length;i<16;i++)t+="0";else t.length>16&&(t=t.substring(0,16));var r=n.enc.Utf8.parse(t),s=n.enc.Utf8.parse(this._iv),a=n.enc.u8array.parse(e),o=n.AES.decrypt(n.enc.Base64.stringify(a),r,{iv:s,mode:n.mode.CBC,padding:n.pad.ZeroPadding}),u=n.enc.u8array.stringify(o);return o=r=a=s=null,u}return e}},r.Digest=function(e,t,i,r,s,a,o,u,l,h){var d=new Uint8Array(32),c=new Uint8Array(32),f=function(e,t){var i,n;for(i=0;i<16;i++)n=e[i]>>4&15,t[2*i]=n<=9?n+48:n+97-10,n=15&e[i],t[2*i+1]=n<=9?n+48:n+97-10;t[32]=0},_=n.algo.MD5.create();_.update(e),_.update(":"),_.update(r),_.update(":"),_.update(t);var p=_.finalize();"md5-sess"==i&&(_=n.algo.MD5.create(),_.update(n.enc.u8array.stringify(p)),_.update(":"),_.update(s),_.update(":"),_.update(a),p=_.finalize()),f(n.enc.u8array.stringify(p),d),p=null,_=null;var m=new Uint8Array(32),_=n.algo.MD5.create();_.update(u),_.update(":"),_.update(l),"auth-int"==h&&(_.update(":"),_.update(m));var v=_.finalize(),g=new Uint8Array(32);f(n.enc.u8array.stringify(v),g);var y=n.algo.MD5.create();y.update(n.enc.u8array.parse(d)),y.update(":"),y.update(s),y.update(":"),h&&(y.update(o),y.update(":"),y.update(a),y.update(":"),y.update(h),y.update(":")),y.update(n.enc.u8array.parse(g));var b=y.finalize();f(n.enc.u8array.stringify(b),c),_=null,y=null,b=null,v=null,g=null,p=null;for(var E="",S=0;S<c.length;S++)E+=String.fromCharCode(c[S]);return E},i.default=r},{}],16:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var s=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),a=e("../utils/logger.js"),o=n(a),u=e("../utils/utf8-conv.js"),l=n(u),h=e("../utils/exception.js"),d=function(){var e=new ArrayBuffer(2);return new DataView(e).setInt16(0,256,!0),256===new Int16Array(e)[0]}(),c=function(){function e(){r(this,e)}return s(e,null,[{key:"parseScriptData",value:function(t,i,n){var r={};try{var s=e.parseValue(t,i,n),a=e.parseValue(t,i+s.size,n-s.size);r[s.data]=a.data}catch(e){o.default.e("AMF",e.toString())}return r}},{key:"parseObject",value:function(t,i,n){if(n<3)throw new h.IllegalStateException("Data not enough when parse ScriptDataObject");var r=e.parseString(t,i,n),s=e.parseValue(t,i+r.size,n-r.size),a=s.objectEnd;return{data:{name:r.data,value:s.data},size:r.size+s.size,objectEnd:a}}},{key:"parseVariable",value:function(t,i,n){return e.parseObject(t,i,n)}},{key:"parseString",value:function(e,t,i){if(i<2)throw new h.IllegalStateException("Data not enough when parse String");var n=new DataView(e,t,i),r=n.getUint16(0,!d),s=void 0;return s=r>0?(0,l.default)(new Uint8Array(e,t+2,r)):"",{data:s,size:2+r}}},{key:"parseLongString",value:function(e,t,i){if(i<4)throw new h.IllegalStateException("Data not enough when parse LongString");var n=new DataView(e,t,i),r=n.getUint32(0,!d),s=void 0;return s=r>0?(0,l.default)(new Uint8Array(e,t+4,r)):"",{data:s,size:4+r}}},{key:"parseDate",value:function(e,t,i){if(i<10)throw new h.IllegalStateException("Data size invalid when parse Date");var n=new DataView(e,t,i),r=n.getFloat64(0,!d);return r+=60*n.getInt16(8,!d)*1e3,{data:new Date(r),size:10}}},{key:"parseValue",value:function(t,i,n){if(n<1)throw new h.IllegalStateException("Data not enough when parse Value");var r=new DataView(t,i,n),s=1,a=r.getUint8(0),u=void 0,l=!1;try{switch(a){case 0:u=r.getFloat64(1,!d),s+=8;break;case 1:u=!!r.getUint8(1),s+=1;break;case 2:var c=e.parseString(t,i+1,n-1);u=c.data,s+=c.size;break;case 3:u={};var f=0;for(9==(16777215&r.getUint32(n-4,!d))&&(f=3);s<n-4;){var _=e.parseObject(t,i+s,n-s-f);if(_.objectEnd)break;u[_.data.name]=_.data.value,s+=_.size}if(s<=n-3){9===(16777215&r.getUint32(s-1,!d))&&(s+=3)}break;case 8:u={},s+=4;var p=0;for(9==(16777215&r.getUint32(n-4,!d))&&(p=3);s<n-8;){var m=e.parseVariable(t,i+s,n-s-p);if(m.objectEnd)break;u[m.data.name]=m.data.value,s+=m.size}if(s<=n-3){9===(16777215&r.getUint32(s-1,!d))&&(s+=3)}break;case 9:u=void 0,s=1,l=!0;break;case 10:u=[];var v=r.getUint32(1,!d);s+=4;for(var g=0;g<v;g++){var y=e.parseValue(t,i+s,n-s);u.push(y.data),s+=y.size}break;case 11:var b=e.parseDate(t,i+1,n-1);u=b.data,s+=b.size;break;case 12:var E=e.parseString(t,i+1,n-1);u=E.data,s+=E.size;break;default:s=n,o.default.w("AMF","Unsupported AMF value type "+a)}}catch(e){o.default.e("AMF",e.toString())}return{data:u,size:s,objectEnd:l}}}]),e}();i.default=c},{"../utils/exception.js":41,"../utils/logger.js":42,"../utils/utf8-conv.js":45}],17:[function(e,t,i){"use strict";Object.defineProperty(i,"__esModule",{value:!0});var n={OK:"OK",FORMAT_ERROR:"FormatError",FORMAT_UNSUPPORTED:"FormatUnsupported",CODEC_UNSUPPORTED:"CodecUnsupported"};i.default=n},{}],18:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var r=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),s=e("../utils/exception.js"),a=function(){function e(t){n(this,e),this.TAG="ExpGolomb",this._buffer=t,this._buffer_index=0,this._total_bytes=t.byteLength,this._total_bits=8*t.byteLength,this._current_word=0,this._current_word_bits_left=0}return r(e,[{key:"destroy",value:function(){this._buffer=null}},{key:"_fillCurrentWord",value:function(){var e=this._total_bytes-this._buffer_index;if(e<=0)throw new s.IllegalStateException("ExpGolomb: _fillCurrentWord() but no bytes available");var t=Math.min(4,e),i=new Uint8Array(4);i.set(this._buffer.subarray(this._buffer_index,this._buffer_index+t)),this._current_word=new DataView(i.buffer).getUint32(0,!1),this._buffer_index+=t,this._current_word_bits_left=8*t}},{key:"readBits",value:function(e){if(e>32)throw new s.InvalidArgumentException("ExpGolomb: readBits() bits exceeded max 32bits!");if(e<=this._current_word_bits_left){var t=this._current_word>>>32-e;return this._current_word<<=e,this._current_word_bits_left-=e,t}var i=this._current_word_bits_left?this._current_word:0;i>>>=32-this._current_word_bits_left;var n=e-this._current_word_bits_left;this._fillCurrentWord();var r=Math.min(n,this._current_word_bits_left),a=this._current_word>>>32-r;return this._current_word<<=r,this._current_word_bits_left-=r,i=i<<r|a}},{key:"readBool",value:function(){return 1===this.readBits(1)}},{key:"readByte",value:function(){return this.readBits(8)}},{key:"_skipLeadingZero",value:function(){var e=void 0;for(e=0;e<this._current_word_bits_left;e++)if(0!=(this._current_word&2147483648>>>e))return this._current_word<<=e,this._current_word_bits_left-=e,e;return this._fillCurrentWord(),e+this._skipLeadingZero()}},{key:"readUEG",value:function(){var e=this._skipLeadingZero();return this.readBits(e+1)-1}},{key:"readSEG",value:function(){var e=this.readUEG();return 1&e?e+1>>>1:-1*(e>>>1)}}]),e}();i.default=a},{"../utils/exception.js":41}],19:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function s(e,t){return e[t]<<24|e[t+1]<<16|e[t+2]<<8|e[t+3]}Object.defineProperty(i,"__esModule",{value:!0});var a="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(e){return typeof e}:function(e){return e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},o=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),u=e("../utils/logger.js"),l=n(u),h=e("./amf-parser.js"),d=n(h),c=e("./sps-parser.js"),f=n(c),_=e("./demux-errors.js"),p=n(_),m=e("../core/media-info.js"),v=n(m),g=e("../utils/exception.js"),y=e("../crypto/crypto.js"),b=n(y),E=e("../remux/aac-silent.js"),S=n(E),k=function(){function e(t,i){r(this,e),this.TAG="FLVDemuxer",this._config=i,this._onError=null,this._onMediaInfo=null,this._onTrackMetadata=null,this._onDataAvailable=null,this._dataOffset=t.dataOffset,this._firstParse=!0,this._dispatch=!1,this._hasAudio=t.hasAudioTrack,this._hasVideo=t.hasVideoTrack,this._hasAudioFlagOverrided=!1,this._hasVideoFlagOverrided=!1,this._audioInitialMetadataDispatched=!1,this._videoInitialMetadataDispatched=!1,this._mediaInfo=new v.default,this._mediaInfo.hasAudio=this._hasAudio,this._mediaInfo.hasVideo=this._hasVideo,this._metadata=null,this._audioMetadata=null,this._videoMetadata=null,this._naluLengthSize=4,this._timestampBase=0,this._timescale=1e3,this._duration=0,this._durationOverrided=!1,this._referenceFrameRate={fixed:!0,fps:25,fps_num:25e3,fps_den:1e3},this._flvSoundRateTable=[5500,11025,22050,44100,48e3],this._mpegSamplingRates=[96e3,88200,64e3,48e3,44100,32e3,24e3,22050,16e3,12e3,11025,8e3,7350],this._mpegAudioV10SampleRateTable=[44100,48e3,32e3,0],this._mpegAudioV20SampleRateTable=[22050,24e3,16e3,0],this._mpegAudioV25SampleRateTable=[11025,12e3,8e3,0],this._mpegAudioL1BitRateTable=[0,32,64,96,128,160,192,224,256,288,320,352,384,416,448,-1],this._mpegAudioL2BitRateTable=[0,32,48,56,64,80,96,112,128,160,192,224,256,320,384,-1],this._mpegAudioL3BitRateTable=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,-1],this._videoTrack={type:"video",id:1,sequenceNumber:0,samples:[],length:0},this._audioTrack={type:"audio",id:2,sequenceNumber:0,samples:[],length:0},this._littleEndian=function(){var e=new ArrayBuffer(2);return new DataView(e).setInt16(0,256,!0),256===new Int16Array(e)[0]}(),this._lastTagType=0,this._enableDecrypt=!1,this._rc4=new b.default.rc4,this._rc4.init(this._config.password),this._aes=new b.default.aes,this._aes.init(this._config.password,"0000000000000000"),this._inputSilent=this._hasAudio}return o(e,[{key:"destroy",value:function(){this._mediaInfo=null,this._metadata=null,this._audioMetadata=null,this._videoMetadata=null,this._videoTrack=null,this._audioTrack=null,this._onError=null,this._onMediaInfo=null,this._onTrackMetadata=null,this._onDataAvailable=null,this._enableDecrypt=!1,this._rc4=null,this._aes=null}},{key:"bindDataSource",value:function(e){return e.onDataArrival=this.parseChunks.bind(this),this}},{key:"resetMediaInfo",value:function(){this._mediaInfo=new v.default}},{key:"_isInitialMetadataDispatched",value:function(){return this._hasVideo&&this._videoInitialMetadataDispatched}},{key:"parseChunks",value:function(t,i){
if(!(this._onError&&this._onMediaInfo&&this._onTrackMetadata&&this._onDataAvailable))throw new g.IllegalStateException("Flv: onError & onMediaInfo & onTrackMetadata & onDataAvailable callback must be specified");var n=0,r=this._littleEndian;if(0===i){if(!(t.byteLength>13))return 0;n=e.probe(t).dataOffset}if(this._firstParse){this._firstParse=!1,i+n!==this._dataOffset&&l.default.w(this.TAG,"First time parsing but chunk byteStart invalid!");0!==new DataView(t,n).getUint32(0,!r)&&l.default.w(this.TAG,"PrevTagSize0 !== 0 !!!"),n+=4}for(;n<t.byteLength;){this._dispatch=!0;var s=new DataView(t,n);if(n+11+4>t.byteLength)break;var a=s.getUint8(0),o=16777215&s.getUint32(0,!r);if(n+11+o+4>t.byteLength)break;if(8===a||9===a||18===a){var u=s.getUint8(4),h=s.getUint8(5),d=s.getUint8(6),c=s.getUint8(7);c>63&&(c=0);var f=d|h<<8|u<<16|c<<24;0!==(16777215&s.getUint32(7,!r))&&l.default.w(this.TAG,"Meet tag which has StreamID != 0!");var _=n+11;switch(a){case 8:this._parseAudioData(t,_,o,f);break;case 9:this._parseVideoData(t,_,o,f,i+n);break;case 18:this._parseScriptData(t,_,o)}var p=s.getUint32(11+o,!r);p!==11+o&&l.default.w(this.TAG,"Invalid PrevTagSize "+p),n+=11+o+4}else l.default.w(this.TAG,"Unsupported tag type "+a+", skipped"),n+=11+o+4}return this._isInitialMetadataDispatched()&&this._dispatch&&(this._audioTrack.length||this._videoTrack.length)&&this._onDataAvailable(this._audioTrack,this._videoTrack),n}},{key:"_parseScriptData",value:function(e,t,i){var n=d.default.parseScriptData(e,t,i);if(n.hasOwnProperty("onMetaData")){if(null==n.onMetaData||"object"!==a(n.onMetaData))return void l.default.w(this.TAG,"Invalid onMetaData structure!");this._metadata&&l.default.w(this.TAG,"Found another onMetaData tag!"),this._metadata=n;var r=this._metadata.onMetaData;if("boolean"==typeof r.hasAudio&&!1===this._hasAudioFlagOverrided&&(this._hasAudio=r.hasAudio,this._mediaInfo.hasAudio=this._hasAudio,this._inputSilent=this._hasAudio),"boolean"==typeof r.hasVideo&&!1===this._hasVideoFlagOverrided&&(this._hasVideo=r.hasVideo,this._mediaInfo.hasVideo=this._hasVideo),"number"==typeof r.audiodatarate&&(this._mediaInfo.audioDataRate=r.audiodatarate),"number"==typeof r.videodatarate&&(this._mediaInfo.videoDataRate=r.videodatarate),"number"==typeof r.width&&(this._mediaInfo.width=r.width),"number"==typeof r.height&&(this._mediaInfo.height=r.height),"number"==typeof r.duration){if(!this._durationOverrided){var s=Math.floor(r.duration*this._timescale);this._duration=s,this._mediaInfo.duration=s}}else this._mediaInfo.duration=0;if("number"==typeof r.framerate){var o=Math.floor(1e3*r.framerate);if(o>0){var u=o/1e3;this._referenceFrameRate.fixed=!0,this._referenceFrameRate.fps=u,this._referenceFrameRate.fps_num=o,this._referenceFrameRate.fps_den=1e3,this._mediaInfo.fps=u}}if("object"===a(r.keyframes)){this._mediaInfo.hasKeyframesIndex=!0;var h=r.keyframes;this._mediaInfo.keyframesIndex=this._parseKeyframesIndex(h),r.keyframes=null}else this._mediaInfo.hasKeyframesIndex=!1;if(this._dispatch=!1,this._mediaInfo.metadata=r,l.default.v(this.TAG,"Parsed onMetaData"),this._mediaInfo.isComplete()&&this._onMediaInfo(this._mediaInfo),this._hasAudio){var c={};c.type="audio",c.id=2,c.timescale=1e3,c.duration=this._mediaInfo.duration,c.audioSampleRate=8e3,c.channelCount=1,c.codec="mp4a.40.5",c.originalCodec="mp4a.40.2",c.config=[45,1420,8,0],c.refSampleDuration=1024/c.audioSampleRate*c.timescale,this._dispatch=!1,this._onTrackMetadata("audio",c)}}}},{key:"_parseKeyframesIndex",value:function(e){for(var t=[],i=[],n=1;n<e.times.length;n++){var r=this._timestampBase+Math.floor(1e3*e.times[n]);t.push(r),i.push(e.filepositions[n])}return{times:t,filepositions:i}}},{key:"_parseAudioData",value:function(e,t,i,n){if(i<=1)return void l.default.w(this.TAG,"Flv: Invalid audio packet, missing SoundData payload!");if(!0!==this._hasAudioFlagOverrided||!1!==this._hasAudio){var r=(this._littleEndian,new DataView(e,t,i)),s=r.getUint8(0),a=s>>>4;if(2!==a&&10!==a)return void this._onError(p.default.CODEC_UNSUPPORTED,"Flv: Unsupported audio codec idx: "+a);var o=0,u=(12&s)>>>2;if(!(u>=0&&u<=4))return void this._onError(p.default.FORMAT_ERROR,"Flv: Invalid audio sample rate idx: "+u);o=this._flvSoundRateTable[u];var h=1&s,d=this._audioMetadata,c=this._audioTrack;if(d||(!1===this._hasAudio&&!1===this._hasAudioFlagOverrided&&(this._hasAudio=!0,this._mediaInfo.hasAudio=!0),d=this._audioMetadata={},d.type="audio",d.id=c.id,d.timescale=this._timescale,d.duration=this._duration,d.audioSampleRate=o,d.channelCount=0===h?1:2),10===a){var f=this._parseAACAudioData(e,t+1,i-1);if(void 0==f)return;if(0===f.packetType){d.config&&l.default.w(this.TAG,"Found another AudioSpecificConfig!");var _=f.data;d.audioSampleRate=_.samplingRate,d.channelCount=_.channelCount,d.codec=_.codec,d.originalCodec=_.originalCodec,d.config=_.config,d.refSampleDuration=1024/d.audioSampleRate*d.timescale,l.default.v(this.TAG,"Parsed AudioSpecificConfig"),this._isInitialMetadataDispatched()?this._dispatch&&(this._audioTrack.length||this._videoTrack.length)&&this._onDataAvailable(this._audioTrack,this._videoTrack):this._audioInitialMetadataDispatched=!0,this._dispatch=!1,this._onTrackMetadata("audio",d);var m=this._mediaInfo;m.audioCodec=d.originalCodec,m.audioSampleRate=d.audioSampleRate,m.audioChannelCount=d.channelCount,m.hasVideo?null!=m.videoCodec&&(m.mimeType='video/x-flv; codecs="'+m.videoCodec+","+m.audioCodec+'"'):m.mimeType='video/x-flv; codecs="'+m.audioCodec+'"',m.isComplete()&&this._onMediaInfo(m)}else if(1===f.packetType){this._inputSilent&&(this._inputSilent=!1);var v=this._timestampBase+n,g={unit:f.data,dts:v,pts:v};c.samples.push(g),c.length+=f.data.length}else l.default.e(this.TAG,"Flv: Unsupported AAC data type "+f.packetType)}else if(2===a){if(!d.codec){var y=this._parseMP3AudioData(e,t+1,i-1,!0);if(void 0==y)return;d.audioSampleRate=y.samplingRate,d.channelCount=y.channelCount,d.codec=y.codec,d.originalCodec=y.originalCodec,d.refSampleDuration=1152/d.audioSampleRate*d.timescale,l.default.v(this.TAG,"Parsed MPEG Audio Frame Header"),this._audioInitialMetadataDispatched=!0,this._onTrackMetadata("audio",d);var b=this._mediaInfo;b.audioCodec=d.codec,b.audioSampleRate=d.audioSampleRate,b.audioChannelCount=d.channelCount,b.audioDataRate=y.bitRate,b.hasVideo?null!=b.videoCodec&&(b.mimeType='video/x-flv; codecs="'+b.videoCodec+","+b.audioCodec+'"'):b.mimeType='video/x-flv; codecs="'+b.audioCodec+'"',b.isComplete()&&this._onMediaInfo(b)}var E=this._parseMP3AudioData(e,t+1,i-1,!1);if(void 0==E)return;var S=this._timestampBase+n,k={unit:E,dts:S,pts:S};c.samples.push(k),c.length+=E.length}}}},{key:"_parseAACAudioData",value:function(e,t,i){if(i<=1)return void l.default.w(this.TAG,"Flv: Invalid AAC packet, missing AACPacketType or/and Data!");var n={},r=new Uint8Array(e,t,i);return n.packetType=r[0],0===r[0]?n.data=this._parseAACAudioSpecificConfig(e,t+1,i-1):n.data=r.subarray(1),n}},{key:"_parseAACAudioSpecificConfig",value:function(e,t,i){var n=new Uint8Array(e,t,i),r=null,s=0,a=0,o=0,u=null;if(s=a=n[0]>>>3,(o=(7&n[0])<<1|n[1]>>>7)<0||o>=this._mpegSamplingRates.length)return void this._onError(p.default.FORMAT_ERROR,"Flv: AAC invalid sampling frequency index!");var l=this._mpegSamplingRates[o],h=(120&n[1])>>>3;if(h<0||h>=8)return void this._onError(p.default.FORMAT_ERROR,"Flv: AAC invalid channel configuration");5===s&&(u=(7&n[1])<<1|n[2]>>>7,n[2]);var d=self.navigator.userAgent.toLowerCase();return-1!==d.indexOf("firefox")?o>=6?(s=5,r=new Array(4),u=o-3):(s=2,r=new Array(2),u=o):-1!==d.indexOf("android")?(s=2,r=new Array(2),u=o):(s=5,u=o,r=new Array(4),o>=6?u=o-3:1===h&&(s=2,r=new Array(2),u=o)),r[0]=s<<3,r[0]|=(15&o)>>>1,r[1]=(15&o)<<7,r[1]|=(15&h)<<3,5===s&&(r[1]|=(15&u)>>>1,r[2]=(1&u)<<7,r[2]|=8,r[3]=0),{config:r,samplingRate:l,channelCount:h,codec:"mp4a.40."+s,originalCodec:"mp4a.40."+a}}},{key:"_parseMP3AudioData",value:function(e,t,i,n){if(i<4)return void l.default.w(this.TAG,"Flv: Invalid MP3 packet, header missing!");var r=(this._littleEndian,new Uint8Array(e,t,i)),s=null;if(n){if(255!==r[0])return;var a=r[1]>>>3&3,o=(6&r[1])>>1,u=(240&r[2])>>>4,h=(12&r[2])>>>2,d=r[3]>>>6&3,c=3!==d?2:1,f=0,_=0;switch(a){case 0:f=this._mpegAudioV25SampleRateTable[h];break;case 2:f=this._mpegAudioV20SampleRateTable[h];break;case 3:f=this._mpegAudioV10SampleRateTable[h]}switch(o){case 1:34,u<this._mpegAudioL3BitRateTable.length&&(_=this._mpegAudioL3BitRateTable[u]);break;case 2:33,u<this._mpegAudioL2BitRateTable.length&&(_=this._mpegAudioL2BitRateTable[u]);break;case 3:32,u<this._mpegAudioL1BitRateTable.length&&(_=this._mpegAudioL1BitRateTable[u])}s={bitRate:_,samplingRate:f,channelCount:c,codec:"mp3",originalCodec:"mp3"}}else s=r;return s}},{key:"_parseVideoData",value:function(e,t,i,n,r){if(i<=1)return void l.default.w(this.TAG,"Flv: Invalid video packet, missing VideoData payload!");if(!0!==this._hasVideoFlagOverrided||!1!==this._hasVideo){var s=new Uint8Array(e,t,i)[0],a=(240&s)>>>4,o=15&s;if(7!==o)return void this._onError(p.default.CODEC_UNSUPPORTED,"Flv: Unsupported codec in video frame: "+o);this._parseAVCVideoPacket(e,t+1,i-1,n,r,a)}}},{key:"_parseAVCVideoPacket",value:function(e,t,i,n,r,s){if(i<4)return void l.default.w(this.TAG,"Flv: Invalid AVC packet, missing AVCPacketType or/and CompositionTime");var a=this._littleEndian,o=new DataView(e,t,i),u=o.getUint8(0),h=16777215&o.getUint32(0,!a);if(0===u)this._parseAVCDecoderConfigurationRecord(e,t+4,i-4);else if(1===u)this._parseAVCVideoData(e,t+4,i-4,n,r,s,h);else if(2!==u)return void this._onError(p.default.FORMAT_ERROR,"Flv: Invalid video packet type "+u)}},{key:"_parseAVCDecoderConfigurationRecord",value:function(e,t,i){if(i<7)return void l.default.w(this.TAG,"Flv: Invalid AVCDecoderConfigurationRecord, lack of data!");var n=this._videoMetadata,r=this._videoTrack,s=this._littleEndian,a=new DataView(e,t,i);n?void 0!==n.avcc&&l.default.w(this.TAG,"Found another AVCDecoderConfigurationRecord!"):(!1===this._hasVideo&&!1===this._hasVideoFlagOverrided&&(this._hasVideo=!0,this._mediaInfo.hasVideo=!0),n=this._videoMetadata={},n.type="video",n.id=r.id,n.timescale=this._timescale,n.duration=this._duration);var o=a.getUint8(0),u=a.getUint8(1);a.getUint8(2),a.getUint8(3);if(1!==o||0===u)return void this._onError(p.default.FORMAT_ERROR,"Flv: Invalid AVCDecoderConfigurationRecord");if(this._naluLengthSize=1+(3&a.getUint8(4)),3!==this._naluLengthSize&&4!==this._naluLengthSize)return void this._onError(p.default.FORMAT_ERROR,"Flv: Strange NaluLengthSizeMinusOne: "+(this._naluLengthSize-1));var h=31&a.getUint8(5);if(0===h)return void this._onError(p.default.FORMAT_ERROR,"Flv: Invalid AVCDecoderConfigurationRecord: No SPS");h>1&&l.default.w(this.TAG,"Flv: Strange AVCDecoderConfigurationRecord: SPS Count = "+h);var d=6;this._lastTagType=1,this._config.password&&this._enableDecrypt&&this._rc4.init(this._config.password);for(var c=0,_=0;_<h;_++){var m=a.getUint16(d,!s);if(d+=2,0!==m){if(this._config.password&&this._enableDecrypt){var v=new Uint8Array(e,t+d+1,m-1),g=this._aes.decrypt(v);a.setUint8(d-1,g.length+1,!s),v.set(g),c=g.length-v.length,v=g=null}var y=new Uint8Array(e,t+d,m+c);d+=m;var b=f.default.parseSPS(y);if(0===_){n.codecWidth=b.codec_size.width,n.codecHeight=b.codec_size.height,n.presentWidth=b.present_size.width,n.presentHeight=b.present_size.height,n.profile=b.profile_string,n.profileValue=b.profile_value,n.level=b.level_string,n.bitDepth=b.bit_depth,n.chromaFormat=b.chroma_format,n.sarRatio=b.sar_ratio,n.frameRate=b.frame_rate,!1!==b.frame_rate.fixed&&0!==b.frame_rate.fps_num&&0!==b.frame_rate.fps_den||(n.frameRate=this._referenceFrameRate);var E=n.frameRate.fps_den,S=n.frameRate.fps_num;n.refSampleDuration=n.timescale*(E/S);for(var k=y.subarray(1,4),w="avc1.",L=0;L<3;L++){var R=k[L].toString(16);R.length<2&&(R="0"+R),w+=R}"avc1.640032"==w&&(w="avc1.4d0014"),n.codec=w;var A=this._mediaInfo;A.width=n.codecWidth,A.height=n.codecHeight,A.fps=n.frameRate.fps,A.profile=n.profile,A.level=n.level,A.chromaFormat=b.chroma_format_string,A.sarNum=n.sarRatio.width,A.sarDen=n.sarRatio.height,A.videoCodec=w,A.hasAudio?null!=A.audioCodec&&(A.mimeType='video/x-flv; codecs="'+A.videoCodec+","+A.audioCodec+'"'):A.mimeType='video/x-flv; codecs="'+A.videoCodec+'"',A.isComplete()&&this._onMediaInfo(A)}}}var O=a.getUint8(d);if(0===O)return void this._onError(p.default.FORMAT_ERROR,"Flv: Invalid AVCDecoderConfigurationRecord: No PPS");O>1&&l.default.w(this.TAG,"Flv: Strange AVCDecoderConfigurationRecord: PPS Count = "+O),d++;for(var x=0,T=0;T<O;T++){var C=a.getUint16(d,!s);if(d+=2,0!==C){if(this._config.password&&this._enableDecrypt){var B=new Uint8Array(e,t+d+1,C-1),D=this._aes.decrypt(B);a.setUint8(d-1,D.length+1),B.set(D),x=D.length-B.length,B=D=null}d+=C}}n.avcc=new Uint8Array(i+c+x);var I=new Uint8Array(e,t,i+c+x);if(I[1]!=n.profileValue&&(I[1]=n.profileValue),this._config.password&&this._config.password.length>0&&this._enableDecrypt)for(var M=22;M<29;M++)I[M]=a.getUint8(M+3);n.avcc.set(I,0),l.default.v(this.TAG,"Parsed AVCDecoderConfigurationRecord"),this._isInitialMetadataDispatched()?this._dispatch&&(this._audioTrack.length||this._videoTrack.length)&&this._onDataAvailable(this._audioTrack,this._videoTrack):this._videoInitialMetadataDispatched=!0,this._dispatch=!1,this._onTrackMetadata("video",n)}},{key:"_parseAVCVideoData",value:function(e,t,i,n,r,s,a){for(var o=this._littleEndian,u=new DataView(e,t,i),h=[],d=0,c=0,f=this._naluLengthSize,_=this._timestampBase+n,p=1===s;c<i;){if(c+4>=i){l.default.w(this.TAG,"Malformed Nalu near timestamp "+_+", offset = "+c+", dataSize = "+i);break}var m=u.getUint32(c,!o);if(3===f&&(m>>>=8),m>i-f)return void l.default.w(this.TAG,"Malformed Nalus near timestamp "+_+", NaluSize > DataSize!");this._config.password&&this._config.password.length>0&&this._enableDecrypt;var v=31&u.getUint8(c+f);if(5===v&&(p=!0,this._lastTagType=1),this._inputSilent){var g=S.default.getSilentFrame("mp4a.40.2",1),y=this._audioTrack,b={unit:g,dts:_,pts:_,duration:35};y.samples.push(b),y.length+=g.byteLength}var E=0;if(this._config.password&&this._config.password.length>0&&this._enableDecrypt){var k=new Uint8Array(e,t+c+5,f+m-5),w=this._aes.decrypt(k);u.setUint32(c,w.length+1,!o),k.set(w),E=w.length-k.length,k=w=null}var L=new Uint8Array(e,t+c,f+m+E),R={type:v,data:L};h.push(R),d+=L.byteLength,c+=f+m}if(h.length){var A=this._videoTrack,O={units:h,length:d,isKeyframe:p,dts:_,cts:a,pts:_+a};p&&(O.fileposition=r),A.samples.push(O),A.length+=d}}},{key:"enableDecrypt",value:function(e){this._enableDecrypt=e}},{key:"onTrackMetadata",get:function(){return this._onTrackMetadata},set:function(e){this._onTrackMetadata=e}},{key:"onMediaInfo",get:function(){return this._onMediaInfo},set:function(e){this._onMediaInfo=e}},{key:"onError",get:function(){return this._onError},set:function(e){this._onError=e}},{key:"onDataAvailable",get:function(){return this._onDataAvailable},set:function(e){this._onDataAvailable=e}},{key:"timestampBase",get:function(){return this._timestampBase},set:function(e){this._timestampBase=e}},{key:"overridedDuration",get:function(){return this._duration},set:function(e){this._durationOverrided=!0,this._duration=e,this._mediaInfo.duration=e}},{key:"overridedHasAudio",set:function(e){this._hasAudioFlagOverrided=!0,this._hasAudio=e,this._mediaInfo.hasAudio=e,this._inputSilent=e}},{key:"overridedHasVideo",set:function(e){this._hasVideoFlagOverrided=!0,this._hasVideo=e,this._mediaInfo.hasVideo=e}}],[{key:"probe",value:function(e){var t=new Uint8Array(e),i={match:!1};if(70!==t[0]||76!==t[1]||86!==t[2]||1!==t[3])return i;var n=(4&t[4])>>>2!=0,r=0!=(1&t[4]),a=s(t,5);return a<9?i:{match:!0,consumed:a,dataOffset:a,hasAudioTrack:n,hasVideoTrack:r}}}]),e}();i.default=k},{"../core/media-info.js":7,"../crypto/crypto.js":15,"../remux/aac-silent.js":37,"../utils/exception.js":41,"../utils/logger.js":42,"./amf-parser.js":16,"./demux-errors.js":17,"./sps-parser.js":20}],20:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var r=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),s=e("./exp-golomb.js"),a=function(e){return e&&e.__esModule?e:{default:e}}(s),o=function(){function e(){n(this,e)}return r(e,null,[{key:"_ebsp2rbsp",value:function(e){for(var t=e,i=t.byteLength,n=new Uint8Array(i),r=0,s=0;s<i;s++)s>=2&&3===t[s]&&0===t[s-1]&&0===t[s-2]||(n[r]=t[s],r++);return new Uint8Array(n.buffer,0,r)}},{key:"parseSPS",value:function(t){var i=e._ebsp2rbsp(t),n=new a.default(i);n.readByte();var r=n.readByte();n.readByte();var s=n.readByte();n.readUEG();var o=e.getProfileString(r),u=e.getLevelString(s),l=1,h=420,d=[0,420,422,444],c=8;if((100===r||110===r||122===r||244===r||44===r||83===r||86===r||118===r||128===r||138===r||144===r)&&(l=n.readUEG(),3===l&&n.readBits(1),l<=3&&(h=d[l]),c=n.readUEG()+8,n.readUEG(),n.readBits(1),n.readBool()))for(var f=3!==l?8:12,_=0;_<f;_++)n.readBool()&&(_<6?e._skipScalingList(n,16):e._skipScalingList(n,64));n.readUEG();var p=n.readUEG();if(0===p)n.readUEG();else if(1===p){n.readBits(1),n.readSEG(),n.readSEG();for(var m=n.readUEG(),v=0;v<m;v++)n.readSEG()}n.readUEG(),n.readBits(1);var g=n.readUEG(),y=n.readUEG(),b=n.readBits(1);0===b&&n.readBits(1),n.readBits(1);var E=0,S=0,k=0,w=0;n.readBool()&&(E=n.readUEG(),S=n.readUEG(),k=n.readUEG(),w=n.readUEG());var L=1,R=1,A=0,O=!0,x=0,T=0;if(n.readBool()){if(n.readBool()){var C=n.readByte(),B=[1,12,10,16,40,24,20,32,80,18,15,64,160,4,3,2],D=[1,11,11,11,33,11,11,11,33,11,11,33,99,3,2,1];C>0&&C<16?(L=B[C-1],R=D[C-1]):255===C&&(L=n.readByte()<<8|n.readByte(),R=n.readByte()<<8|n.readByte())}if(n.readBool()&&n.readBool(),n.readBool()&&(n.readBits(4),n.readBool()&&n.readBits(24)),n.readBool()&&(n.readUEG(),n.readUEG()),n.readBool()){var I=n.readBits(32),M=n.readBits(32);O=n.readBool(),x=M,T=2*I,A=x/T}}var j=1;1===L&&1===R||(j=L/R);var P=0,U=0;if(0===l)P=1,U=2-b;else{var N=3===l?1:2,F=1===l?2:1;P=N,U=F*(2-b)}var z=16*(g+1),G=16*(y+1)*(2-b);z-=(E+S)*P,G-=(k+w)*U;var V=Math.ceil(z*j);return n.destroy(),n=null,{profile_value:r,profile_string:o,level_string:u,bit_depth:c,chroma_format:h,chroma_format_string:e.getChromaFormatString(h),frame_rate:{fixed:O,fps:A,fps_den:T,fps_num:x},sar_ratio:{width:L,height:R},codec_size:{width:z,height:G},present_size:{width:V,height:G}}}},{key:"_skipScalingList",value:function(e,t){for(var i=8,n=8,r=0,s=0;s<t;s++)0!==n&&(r=e.readSEG(),n=(i+r+256)%256),i=0===n?i:n}},{key:"getProfileString",value:function(e){switch(e){case 66:return"Baseline";case 77:return"Main";case 88:return"Extended";case 100:return"High";case 110:return"High10";case 122:return"High422";case 244:return"High444";default:return"Unknown"}}},{key:"getLevelString",value:function(e){return(e/10).toFixed(1)}},{key:"getChromaFormatString",value:function(e){switch(e){case 420:return"4:2:0";case 422:return"4:2:2";case 444:return"4:4:4";default:return"Unknown"}}}]),e}();i.default=o},{"./exp-golomb.js":18}],21:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}function r(e,t){var i=e;if(null==i||"object"!==(void 0===i?"undefined":o(i)))throw new E.InvalidArgumentException("MediaDataSource must be an javascript object!");if(!i.hasOwnProperty("type"))throw new E.InvalidArgumentException("MediaDataSource must has type field to indicate video file type!");switch(i.type){case"flv":return new f.default(i,t);case"janusstream":return null;default:return new p.default(i,t)}}function s(){return d.default.supportMSEH264Playback()}function a(){return d.default.getFeatureList()}Object.defineProperty(i,"__esModule",{value:!0});var o="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(e){return typeof e}:function(e){return e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},u=e("./utils/polyfill.js"),l=n(u),h=e("./core/features.js"),d=n(h),c=e("./player/flv-player.js"),f=n(c),_=e("./player/native-player.js"),p=n(_),m=e("./player/player-events.js"),v=n(m),g=e("./player/player-errors.js"),y=e("./utils/logging-control.js"),b=n(y),E=e("./utils/exception.js");l.default.install();var S={};S.createPlayer=r,S.isSupported=s,S.getFeatureList=a,S.Events=v.default,S.ErrorTypes=g.ErrorTypes,S.ErrorDetails=g.ErrorDetails,S.FlvPlayer=f.default,S.NativePlayer=p.default,S.LoggingControl=b.default,Object.defineProperty(S,"version",{enumerable:!0,get:function(){return"1.3.3"}}),i.default=S},{"./core/features.js":6,"./player/flv-player.js":33,"./player/native-player.js":34,"./player/player-errors.js":35,"./player/player-events.js":36,"./utils/exception.js":41,"./utils/logging-control.js":43,"./utils/polyfill.js":44}],22:[function(e,t,i){"use strict";t.exports=e("./flv.js").default},{"./flv.js":21}],23:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function s(e,t){if(!e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return!t||"object"!=typeof t&&"function"!=typeof t?e:t}function a(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function, not "+typeof t);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}}),t&&(Object.setPrototypeOf?Object.setPrototypeOf(e,t):e.__proto__=t)}Object.defineProperty(i,"__esModule",{value:!0});var o="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(e){return typeof e}:function(e){return e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},u=function e(t,i,n){null===t&&(t=Function.prototype);var r=Object.getOwnPropertyDescriptor(t,i);if(void 0===r){var s=Object.getPrototypeOf(t);return null===s?void 0:e(s,i,n)}if("value"in r)return r.value;var a=r.get;if(void 0!==a)return a.call(n)},l=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),h=e("../utils/logger.js"),d=(n(h),e("../utils/browser.js")),c=n(d),f=e("./loader.js"),_=e("../utils/exception.js"),p=e("../crypto/crypto.js"),m=n(p),v=function(e){function t(e,i){r(this,t);var n=s(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,"fetch-stream-loader"));return n.TAG="FetchStreamLoader",n._seekHandler=e,n._config=i,n._needStash=!0,n._requestAbort=!1,n._contentLength=null,n._receivedLength=0,n._requestURL="",n._bInvaidPwd=!1,n._authInfo=null,n}return a(t,e),l(t,null,[{key:"isSupported",value:function(){try{var e=c.default.msedge&&c.default.version.minor>=15048,t=!c.default.msedge||e;return self.fetch&&self.ReadableStream&&t&&!c.default.firefox}catch(e){return!1}}}]),l(t,[{key:"destroy",value:function(){this.isWorking()&&this.abort(),u(t.prototype.__proto__||Object.getPrototypeOf(t.prototype),"destroy",this).call(this)}},{key:"open",value:function(e,t){var i=this;this._dataSource=e,this._range=t,this._receivedLength=0;var n=e.url;this._config.reuseRedirectedURL&&void 0!=e.redirectedURL&&(n=e.redirectedURL);var r=this._seekHandler.getConfig(n,t);this._requestURL=r.url;var s=new self.Headers;if("object"===o(r.headers)){var a=r.headers;for(var u in a)a.hasOwnProperty(u)&&s.append(u,a[u])}this._authInfo&&this._authInfo.length?(s.append("Authorization",this._authInfo),this._authInfo=null):(this._config.date&&s.append("x-amz-date",this._config.date),this._config.auth&&s.append("Authorization",this._config.auth));var l={method:"GET",headers:s,mode:"cors",cache:"default",referrerPolicy:"no-referrer-when-downgrade"};!1===e.cors&&(l.mode="same-origin"),e.withCredentials&&(l.credentials="include"),e.referrerPolicy&&(l.referrerPolicy=e.referrerPolicy),this._status=f.LoaderStatus.kConnecting,self.fetch(r.url,l).then(function(e){if(i._requestAbort)return i._authInfo=null,i._requestAbort=!1,void(i._status=f.LoaderStatus.kIdle);if(e.ok&&e.status>=200&&e.status<=299){if(i._authInfo=null,e.url!==r.url&&i._onURLRedirect){var t=i._seekHandler.removeURLParameters(e.url);i._onURLRedirect(t)}var n=e.headers.get("Content-Length");null!=n&&(i._contentLength=parseInt(n),0!==i._contentLength&&i._onContentLengthKnown&&i._onContentLengthKnown(i._contentLength));var s="true"===e.headers.get("Secretive");return console.log("encrypted ? "+s),i.onOpened(s),i._pump.call(i,e.body.getReader())}if(401==e.status&&!i._bInvaidPwd){(e.redirected||e.url&&e.url.length&&e.url!=i._dataSource.url)&&(i._dataSource.url=i._requestURL=e.url),i._bInvaidPwd=!0;var a=e.headers.get("WWW-Authenticate"),o=a.indexOf('realm="')+7,u=a.substring(o,a.indexOf(",",o)-1);o=a.indexOf('qop="')+5;var l=a.substring(o,a.indexOf(",",o)-1);l.replace('"',""),o=a.indexOf('nonce="')+7;var h=a.substring(o,a.indexOf('"',o));o=a.indexOf('algorithm="')+11;var d=a.substring(o,a.indexOf(",",o)-1),c=i._config.username,p=i._config.password,v=i._requestURL.substring(i._requestURL.indexOf("/",8),i._requestURL.length),g=m.default.generateUUID(),y=m.default.Digest(c,p,d,u,h,g,"00000001","GET",v,l);return i._authInfo='Digest username="'+c+'", realm="'+u+'", nonce="'+h+'", uri="'+v+'", algorithm='+d+', response="'+y+'", opaque="5ccc069c403ebaf9f0171e9517f40e41", qop="'+l+'", nc=00000001, cnonce="'+g+'"',void i.open(i._dataSource,i._range)}if(i._status=f.LoaderStatus.kError,!i._onError)throw new _.RuntimeException("FetchStreamLoader: Http code invalid, "+e.status+" "+e.statusText);i._onError(f.LoaderErrors.HTTP_STATUS_CODE_INVALID,{code:e.status,msg:e.statusText})}).catch(function(e){if(i._status=f.LoaderStatus.kError,!i._onError)throw e;i._onError(f.LoaderErrors.EXCEPTION,{code:-1,msg:e.message})})}},{key:"abort",value:function(){this._authInfo=null,this._bInvaidPwd=!1,this._requestAbort=!0}},{key:"_pump",value:function(e){var t=this;return e.read().then(function(i){if(i.done)t._status=f.LoaderStatus.kComplete,t._onComplete&&t._onComplete(t._range.from,t._range.from+t._receivedLength-1);else{if(!0===t._requestAbort)return t._requestAbort=!1,t._status=f.LoaderStatus.kComplete,e.cancel();t._status=f.LoaderStatus.kBuffering;var n=i.value.buffer,r=t._range.from+t._receivedLength;t._receivedLength+=n.byteLength,t._onDataArrival&&t._onDataArrival(n,r,t._receivedLength),t._pump(e)}}).catch(function(e){if(11!==e.code||!c.default.msedge){t._status=f.LoaderStatus.kError;var i=0,n=null;if(19!==e.code&&"network error"!==e.message||!(null===t._contentLength||null!==t._contentLength&&t._receivedLength<t._contentLength)?(i=f.LoaderErrors.EXCEPTION,n={code:e.code,msg:e.message}):(i=f.LoaderErrors.EARLY_EOF,n={code:e.code,msg:"Fetch stream meet Early-EOF"}),!t._onError)throw new _.RuntimeException(n.msg);t._onError(i,n)}})}}]),t}(f.BaseLoader);i.default=v},{"../crypto/crypto.js":15,"../utils/browser.js":40,"../utils/exception.js":41,"../utils/logger.js":42,"./loader.js":25}],24:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var s=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),a=e("../utils/logger.js"),o=n(a),u=e("./speed-sampler.js"),l=n(u),h=e("./loader.js"),d=e("./fetch-stream-loader.js"),c=n(d),f=e("./xhr-moz-chunked-loader.js"),_=n(f),p=e("./xhr-msstream-loader.js"),m=(n(p),e("./xhr-range-loader.js")),v=n(m),g=e("./websocket-loader.js"),y=n(g),b=e("./range-seek-handler.js"),E=n(b),S=e("./param-seek-handler.js"),k=n(S),w=e("../utils/exception.js"),L=function(){function e(t,i,n){r(this,e),this.TAG="IOController",this._config=i,this._extraData=n,this._stashInitialSize=393216,void 0!=i.stashInitialSize&&i.stashInitialSize>0&&(this._stashInitialSize=i.stashInitialSize),this._stashUsed=0,this._stashSize=this._stashInitialSize,this._bufferSize=3145728,this._stashBuffer=new ArrayBuffer(this._bufferSize),this._stashByteStart=0,this._enableStash=!0,!1===i.enableStashBuffer&&(this._enableStash=!1),this._loader=null,this._loaderClass=null,this._seekHandler=null,this._dataSource=t,this._isWebSocketURL=/wss?:\/\/(.+?)/.test(t.url),this._refTotalLength=t.filesize?t.filesize:null,this._totalLength=this._refTotalLength,this._fullRequestFlag=!1,this._currentRange=null,this._redirectedURL=null,this._speedNormalized=0,this._speedSampler=new l.default,this._speedNormalizeList=[64,128,256,384,512,768,1024,1536,2048,3072,4096],this._isEarlyEofReconnecting=!1,this._paused=!1,this._resumeFrom=0,this._onDataArrival=null,this._onSeeked=null,this._onError=null,this._onComplete=null,this._onRedirect=null,this._onRecoveredEarlyEof=null,this._selectSeekHandler(),this._selectLoader(),this._createLoader()}return s(e,[{key:"destroy",value:function(){this._loader.isWorking()&&this._loader.abort(),this._loader.destroy(),this._loader=null,this._loaderClass=null,this._dataSource=null,this._stashBuffer=null,this._stashUsed=this._stashSize=this._bufferSize=this._stashByteStart=0,this._currentRange=null,this._speedSampler=null,this._isEarlyEofReconnecting=!1,this._onDataArrival=null,this._onSeeked=null,this._onError=null,this._onComplete=null,this._onRedirect=null,this._onRecoveredEarlyEof=null,this._extraData=null}},{key:"isWorking",value:function(){return this._loader&&this._loader.isWorking()&&!this._paused}},{key:"isPaused",value:function(){return this._paused}},{key:"_selectSeekHandler",value:function(){var e=this._config;if("range"===e.seekType)this._seekHandler=new E.default(this._config.rangeLoadZeroStart);else if("param"===e.seekType){var t=e.seekParamStart||"bstart",i=e.seekParamEnd||"bend";this._seekHandler=new k.default(t,i)}else{if("custom"!==e.seekType)throw new w.InvalidArgumentException("Invalid seekType in config: "+e.seekType);if("function"!=typeof e.customSeekHandler)throw new w.InvalidArgumentException("Custom seekType specified in config but invalid customSeekHandler!");this._seekHandler=new e.customSeekHandler}}},{key:"_selectLoader",value:function(){if(this._isWebSocketURL)this._loaderClass=y.default;else if(c.default.isSupported())this._loaderClass=c.default;else if(_.default.isSupported())this._loaderClass=_.default;else{if(!v.default.isSupported())throw new w.RuntimeException("Your browser doesn't support xhr with arraybuffer responseType!");this._loaderClass=v.default}}},{key:"_createLoader",value:function(){this._loader=new this._loaderClass(this._seekHandler,this._config),!1===this._loader.needStashBuffer&&(this._enableStash=!1),this._loader.onContentLengthKnown=this._onContentLengthKnown.bind(this),this._loader.onURLRedirect=this._onURLRedirect.bind(this),this._loader.onDataArrival=this._onLoaderChunkArrival.bind(this),this._loader.onComplete=this._onLoaderComplete.bind(this),this._loader.onError=this._onLoaderError.bind(this),this._loader.onOpened=this._onIOOpened.bind(this)}},{key:"open",value:function(e){this._currentRange={from:0,to:-1},this._speedSampler.reset(),e||(this._fullRequestFlag=!0),this._loader.open(this._dataSource,Object.assign({},this._currentRange))}},{key:"abort",value:function(){this._loader.abort(),this._paused&&(this._paused=!1,this._resumeFrom=0)}},{key:"pause",value:function(){this.isWorking()&&(this._loader.abort(),0!==this._stashUsed?(this._resumeFrom=this._stashByteStart,this._currentRange.to=this._stashByteStart-1):this._resumeFrom=this._currentRange.to+1,this._stashUsed=0,this._stashByteStart=0,this._paused=!0)}},{key:"resume",value:function(){if(this._paused){this._paused=!1;var e=this._resumeFrom;this._resumeFrom=0,this._internalSeek(e,!0)}}},{key:"resumeTime",
value:function(e){this._paused&&(this._paused=!1,this._resumeFrom=0,this._internalSeekTime(e,!0))}},{key:"seek",value:function(e){this._paused=!1,this._stashUsed=0,this._stashByteStart=0,this._internalSeek(e,!0)}},{key:"_internalSeek",value:function(e,t){this._loader.isWorking()&&this._loader.abort(),this._flushStashBuffer(t),this._loader.destroy(),this._loader=null;var i={from:e,to:-1};this._currentRange={from:i.from,to:-1},this._speedSampler.reset(),this._stashSize=this._stashInitialSize,this._createLoader(),this._loader.open(this._dataSource,i),this._loader._range.from=0,this._onSeeked&&this._onSeeked()}},{key:"_internalSeekTime",value:function(e,t){this._loader.isWorking()&&this._loader.abort(),this._flushStashBuffer(t),this._loader.destroy(),this._loader=null;var i={from:0,to:-1,time:e};this._currentRange={from:i.from,to:-1,time:e},this._speedSampler.reset(),this._stashSize=this._stashInitialSize,this._createLoader(),this._loader.open(this._dataSource,i),this._loader._range.from=0,this.updateUrl(this._loader._requestURL),this._onSeeked&&this._onSeeked()}},{key:"updateUrl",value:function(e){if(!e||"string"!=typeof e||0===e.length)throw new w.InvalidArgumentException("Url must be a non-empty string!");this._dataSource.url=e,console.log("update url "+e)}},{key:"_expandBuffer",value:function(e){for(var t=this._stashSize;t+1048576<e;)t*=2;if((t+=1048576)!==this._bufferSize){var i=new ArrayBuffer(t);if(this._stashUsed>0){var n=new Uint8Array(this._stashBuffer,0,this._stashUsed);new Uint8Array(i,0,t).set(n,0)}this._stashBuffer=i,this._bufferSize=t}}},{key:"_normalizeSpeed",value:function(e){var t=this._speedNormalizeList,i=t.length-1,n=0,r=0,s=i;if(e<t[0])return t[0];for(;r<=s;){if((n=r+Math.floor((s-r)/2))===i||e>=t[n]&&e<t[n+1])return t[n];t[n]<e?r=n+1:s=n-1}}},{key:"_adjustStashSize",value:function(e){var t=0;(t=this._config.isLive?e:e<512?e:e>=512&&e<=1024?Math.floor(1.5*e):2*e)>8192&&(t=8192);var i=1024*t+1048576;this._bufferSize<i&&this._expandBuffer(i),this._stashSize=1024*t}},{key:"_dispatchChunks",value:function(e,t){return this._currentRange.to=t+e.byteLength-1,this._onDataArrival(e,t)}},{key:"_onIOOpened",value:function(e){this.onOpened&&this.onOpened(e)}},{key:"_onURLRedirect",value:function(e){this._redirectedURL=e,this._onRedirect&&this._onRedirect(e)}},{key:"_onContentLengthKnown",value:function(e){e&&this._fullRequestFlag&&(this._totalLength=e,this._fullRequestFlag=!1)}},{key:"_onLoaderChunkArrival",value:function(e,t,i){if(!this._onDataArrival)throw new w.IllegalStateException("IOController: No existing consumer (onDataArrival) callback!");if(!this._paused)if(this._isEarlyEofReconnecting&&(this._isEarlyEofReconnecting=!1,this._onRecoveredEarlyEof&&this._onRecoveredEarlyEof()),this._speedSampler.addBytes(e.byteLength),this._enableStash)if(0===this._stashUsed&&0===this._stashByteStart&&(this._stashByteStart=t),this._stashUsed+e.byteLength<=this._stashSize){var n=new Uint8Array(this._stashBuffer,0,this._stashSize);n.set(new Uint8Array(e),this._stashUsed),this._stashUsed+=e.byteLength}else{var r=new Uint8Array(this._stashBuffer,0,this._bufferSize);if(this._stashUsed>0){var s=this._stashBuffer.slice(0,this._stashUsed),a=this._dispatchChunks(s,this._stashByteStart);if(a<s.byteLength){if(a>0){var o=new Uint8Array(s,a);r.set(o,0),this._stashUsed=o.byteLength,this._stashByteStart+=a}}else this._stashUsed=0,this._stashByteStart+=a;this._stashUsed+e.byteLength>this._bufferSize&&(this._expandBuffer(this._stashUsed+e.byteLength),r=new Uint8Array(this._stashBuffer,0,this._bufferSize)),r.set(new Uint8Array(e),this._stashUsed),this._stashUsed+=e.byteLength}else{var u=this._dispatchChunks(e,t);if(u<e.byteLength){var l=e.byteLength-u;l>this._bufferSize&&(this._expandBuffer(l),r=new Uint8Array(this._stashBuffer,0,this._bufferSize)),r.set(new Uint8Array(e,u),0),this._stashUsed+=l,this._stashByteStart=t+u}}}else if(0===this._stashUsed){var h=this._dispatchChunks(e,t);if(h<e.byteLength){var d=e.byteLength-h;d>this._bufferSize&&this._expandBuffer(d);var c=new Uint8Array(this._stashBuffer,0,this._bufferSize);c.set(new Uint8Array(e,h),0),this._stashUsed+=d,this._stashByteStart=t+h}}else{this._stashUsed+e.byteLength>this._bufferSize&&this._expandBuffer(this._stashUsed+e.byteLength);var f=new Uint8Array(this._stashBuffer,0,this._bufferSize);f.set(new Uint8Array(e),this._stashUsed),this._stashUsed+=e.byteLength;var _=this._dispatchChunks(this._stashBuffer.slice(0,this._stashUsed),this._stashByteStart);if(_<this._stashUsed&&_>0){var p=new Uint8Array(this._stashBuffer,_);f.set(p,0)}this._stashUsed-=_,this._stashByteStart+=_}}},{key:"_flushStashBuffer",value:function(e){if(this._stashUsed>0){var t=this._stashBuffer.slice(0,this._stashUsed),i=this._dispatchChunks(t,this._stashByteStart),n=t.byteLength-i;if(i<t.byteLength){if(!e){if(i>0){var r=new Uint8Array(this._stashBuffer,0,this._bufferSize),s=new Uint8Array(t,i);r.set(s,0),this._stashUsed=s.byteLength,this._stashByteStart+=i}return 0}o.default.w(this.TAG,n+" bytes unconsumed data remain when flush buffer, dropped")}return this._stashUsed=0,this._stashByteStart=0,n}return 0}},{key:"_onLoaderComplete",value:function(e,t){this._flushStashBuffer(!0),this._onComplete&&this._onComplete(this._extraData)}},{key:"_onLoaderError",value:function(e,t){switch(o.default.e(this.TAG,"Loader error, code = "+t.code+", msg = "+t.msg),this._flushStashBuffer(!1),this._isEarlyEofReconnecting&&(this._isEarlyEofReconnecting=!1,e=h.LoaderErrors.UNRECOVERABLE_EARLY_EOF),e){case h.LoaderErrors.EARLY_EOF:if(!this._config.isLive&&this._totalLength){var i=this._currentRange.to+1;return void(i<this._totalLength&&(o.default.w(this.TAG,"Connection lost, trying reconnect..."),this._isEarlyEofReconnecting=!0,this._internalSeek(i,!1)))}e=h.LoaderErrors.UNRECOVERABLE_EARLY_EOF;break;case h.LoaderErrors.UNRECOVERABLE_EARLY_EOF:case h.LoaderErrors.CONNECTING_TIMEOUT:case h.LoaderErrors.HTTP_STATUS_CODE_INVALID:case h.LoaderErrors.EXCEPTION:}if(!this._onError)throw new w.RuntimeException("IOException: "+t.msg);this._onError(e,t)}},{key:"status",get:function(){return this._loader.status}},{key:"extraData",get:function(){return this._extraData},set:function(e){this._extraData=e}},{key:"onDataArrival",get:function(){return this._onDataArrival},set:function(e){this._onDataArrival=e}},{key:"onSeeked",get:function(){return this._onSeeked},set:function(e){this._onSeeked=e}},{key:"onError",get:function(){return this._onError},set:function(e){this._onError=e}},{key:"onComplete",get:function(){return this._onComplete},set:function(e){this._onComplete=e}},{key:"onRedirect",get:function(){return this._onRedirect},set:function(e){this._onRedirect=e}},{key:"onRecoveredEarlyEof",get:function(){return this._onRecoveredEarlyEof},set:function(e){this._onRecoveredEarlyEof=e}},{key:"currentURL",get:function(){return this._dataSource.url}},{key:"hasRedirect",get:function(){return null!=this._redirectedURL||void 0!=this._dataSource.redirectedURL}},{key:"currentRedirectedURL",get:function(){return this._redirectedURL||this._dataSource.redirectedURL}},{key:"currentSpeed",get:function(){return this._loaderClass===v.default?this._loader.currentSpeed:this._speedSampler.lastSecondKBps}},{key:"loaderType",get:function(){return this._loader.type}}]),e}();i.default=L},{"../utils/exception.js":41,"../utils/logger.js":42,"./fetch-stream-loader.js":23,"./loader.js":25,"./param-seek-handler.js":26,"./range-seek-handler.js":27,"./speed-sampler.js":28,"./websocket-loader.js":29,"./xhr-moz-chunked-loader.js":30,"./xhr-msstream-loader.js":31,"./xhr-range-loader.js":32}],25:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0}),i.BaseLoader=i.LoaderErrors=i.LoaderStatus=void 0;var r=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),s=e("../utils/exception.js"),a=i.LoaderStatus={kIdle:0,kConnecting:1,kBuffering:2,kError:3,kComplete:4};i.LoaderErrors={OK:"OK",EXCEPTION:"Exception",HTTP_STATUS_CODE_INVALID:"HttpStatusCodeInvalid",CONNECTING_TIMEOUT:"ConnectingTimeout",EARLY_EOF:"EarlyEof",UNRECOVERABLE_EARLY_EOF:"UnrecoverableEarlyEof"},i.BaseLoader=function(){function e(t){n(this,e),this._type=t||"undefined",this._status=a.kIdle,this._needStash=!1,this._onContentLengthKnown=null,this._onURLRedirect=null,this._onDataArrival=null,this._onError=null,this._onComplete=null}return r(e,[{key:"destroy",value:function(){this._status=a.kIdle,this._onContentLengthKnown=null,this._onURLRedirect=null,this._onDataArrival=null,this._onError=null,this._onComplete=null}},{key:"isWorking",value:function(){return this._status===a.kConnecting||this._status===a.kBuffering}},{key:"open",value:function(e,t){throw new s.NotImplementedException("Unimplemented abstract function!")}},{key:"abort",value:function(){throw new s.NotImplementedException("Unimplemented abstract function!")}},{key:"type",get:function(){return this._type}},{key:"status",get:function(){return this._status}},{key:"needStashBuffer",get:function(){return this._needStash}},{key:"onContentLengthKnown",get:function(){return this._onContentLengthKnown},set:function(e){this._onContentLengthKnown=e}},{key:"onURLRedirect",get:function(){return this._onURLRedirect},set:function(e){this._onURLRedirect=e}},{key:"onDataArrival",get:function(){return this._onDataArrival},set:function(e){this._onDataArrival=e}},{key:"onError",get:function(){return this._onError},set:function(e){this._onError=e}},{key:"onComplete",get:function(){return this._onComplete},set:function(e){this._onComplete=e}}]),e}()},{"../utils/exception.js":41}],26:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function r(e,t){return(Array(t).join("0")+e).slice(-t)}Object.defineProperty(i,"__esModule",{value:!0});var s=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),a=function(){function e(t,i){n(this,e),this._startName=t,this._endName=i}return s(e,[{key:"getConfig",value:function(e,t){var i=e,n=i;if(t&&t.time){var s=t.time/1e3,a=i.indexOf("starttime=")+10,o=i.substring(a,a+15),u=(i.substring(0,a),i.substring(a+15,i.length),o.substring(0,4)),l=o.substring(4,6),h=o.substring(6,8),d=o.substring(9,11),c=o.substring(11,13),f=o.substring(13,15),_=new Date(u,l,h,d,c,f,0),p=Date.parse(_);p+=1e3*s;var m=new Date(p),v=r(m.getFullYear(),4)+r(m.getMonth(),2)+r(m.getDate(),2)+"T"+r(m.getHours(),2)+r(m.getMinutes(),2)+r(m.getSeconds(),2);n=n.replace(o,v)}return{url:n,headers:null}}},{key:"removeURLParameters",value:function(e){return e}}]),e}();i.default=a},{}],27:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var r=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),s=function(){function e(t){n(this,e),this._zeroStart=t||!1}return r(e,[{key:"getConfig",value:function(e,t){var i={};if(0!==t.from||-1!==t.to){var n=void 0;n=-1!==t.to?"bytes="+t.from.toString()+"-"+t.to.toString():"bytes="+t.from.toString()+"-",i.Range=n}else this._zeroStart&&(i.Range="bytes=0-");return{url:e,headers:i}}},{key:"removeURLParameters",value:function(e){return e}}]),e}();i.default=s},{}],28:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var r=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),s=function(){function e(){n(this,e),this._firstCheckpoint=0,this._lastCheckpoint=0,this._intervalBytes=0,this._totalBytes=0,this._lastSecondBytes=0,self.performance&&self.performance.now?this._now=self.performance.now.bind(self.performance):this._now=Date.now}return r(e,[{key:"reset",value:function(){this._firstCheckpoint=this._lastCheckpoint=0,this._totalBytes=this._intervalBytes=0,this._lastSecondBytes=0}},{key:"addBytes",value:function(e){0===this._firstCheckpoint?(this._firstCheckpoint=this._now(),this._lastCheckpoint=this._firstCheckpoint,this._intervalBytes+=e,this._totalBytes+=e):this._now()-this._lastCheckpoint<1e3?(this._intervalBytes+=e,this._totalBytes+=e):(this._lastSecondBytes=this._intervalBytes,this._intervalBytes=e,this._totalBytes+=e,this._lastCheckpoint=this._now())}},{key:"currentKBps",get:function(){this.addBytes(0);var e=(this._now()-this._lastCheckpoint)/1e3;return 0==e&&(e=1),this._intervalBytes/e/1024}},{key:"lastSecondKBps",get:function(){return this.addBytes(0),0!==this._lastSecondBytes?this._lastSecondBytes/1024:this._now()-this._lastCheckpoint>=500?this.currentKBps:0}},{key:"averageKBps",get:function(){var e=(this._now()-this._firstCheckpoint)/1e3;return this._totalBytes/e/1024}}]),e}();i.default=s},{}],29:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function r(e,t){if(!e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return!t||"object"!=typeof t&&"function"!=typeof t?e:t}function s(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function, not "+typeof t);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}}),t&&(Object.setPrototypeOf?Object.setPrototypeOf(e,t):e.__proto__=t)}Object.defineProperty(i,"__esModule",{value:!0});var a=function e(t,i,n){null===t&&(t=Function.prototype);var r=Object.getOwnPropertyDescriptor(t,i);if(void 0===r){var s=Object.getPrototypeOf(t);return null===s?void 0:e(s,i,n)}if("value"in r)return r.value;var a=r.get;if(void 0!==a)return a.call(n)},o=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),u=e("../utils/logger.js"),l=(function(e){e&&e.__esModule}(u),e("./loader.js")),h=e("../utils/exception.js"),d=function(e){function t(){n(this,t);var e=r(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,"websocket-loader"));return e.TAG="WebSocketLoader",e._needStash=!0,e._ws=null,e._requestAbort=!1,e._receivedLength=0,e}return s(t,e),o(t,null,[{key:"isSupported",value:function(){try{return void 0!==self.WebSocket}catch(e){return!1}}}]),o(t,[{key:"destroy",value:function(){this._ws&&this.abort(),a(t.prototype.__proto__||Object.getPrototypeOf(t.prototype),"destroy",this).call(this)}},{key:"open",value:function(e){try{var t=this._ws=new self.WebSocket(e.url);t.binaryType="arraybuffer",t.onopen=this._onWebSocketOpen.bind(this),t.onclose=this._onWebSocketClose.bind(this),t.onmessage=this._onWebSocketMessage.bind(this),t.onerror=this._onWebSocketError.bind(this),this._status=l.LoaderStatus.kConnecting}catch(e){this._status=l.LoaderStatus.kError;var i={code:e.code,msg:e.message};if(!this._onError)throw new h.RuntimeException(i.msg);this._onError(l.LoaderErrors.EXCEPTION,i)}}},{key:"abort",value:function(){var e=this._ws;!e||0!==e.readyState&&1!==e.readyState||(this._requestAbort=!0,e.close()),this._ws=null,this._status=l.LoaderStatus.kComplete}},{key:"_onWebSocketOpen",value:function(e){this._status=l.LoaderStatus.kBuffering}},{key:"_onWebSocketClose",value:function(e){if(!0===this._requestAbort)return void(this._requestAbort=!1);this._status=l.LoaderStatus.kComplete,this._onComplete&&this._onComplete(0,this._receivedLength-1)}},{key:"_onWebSocketMessage",value:function(e){var t=this;if(e.data instanceof ArrayBuffer)this._dispatchArrayBuffer(e.data);else if(e.data instanceof Blob){var i=new FileReader;i.onload=function(){t._dispatchArrayBuffer(i.result)},i.readAsArrayBuffer(e.data)}else{this._status=l.LoaderStatus.kError;var n={code:-1,msg:"Unsupported WebSocket message type: "+e.data.constructor.name};if(!this._onError)throw new h.RuntimeException(n.msg);this._onError(l.LoaderErrors.EXCEPTION,n)}}},{key:"_dispatchArrayBuffer",value:function(e){var t=e,i=this._receivedLength;this._receivedLength+=t.byteLength,this._onDataArrival&&this._onDataArrival(t,i,this._receivedLength)}},{key:"_onWebSocketError",value:function(e){this._status=l.LoaderStatus.kError;var t={code:e.code,msg:e.message};if(!this._onError)throw new h.RuntimeException(t.msg);this._onError(l.LoaderErrors.EXCEPTION,t)}}]),t}(l.BaseLoader);i.default=d},{"../utils/exception.js":41,"../utils/logger.js":42,"./loader.js":25}],30:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function s(e,t){if(!e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return!t||"object"!=typeof t&&"function"!=typeof t?e:t}function a(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function, not "+typeof t);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}}),t&&(Object.setPrototypeOf?Object.setPrototypeOf(e,t):e.__proto__=t)}Object.defineProperty(i,"__esModule",{value:!0});var o="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(e){return typeof e}:function(e){return e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},u=function e(t,i,n){null===t&&(t=Function.prototype);var r=Object.getOwnPropertyDescriptor(t,i);if(void 0===r){var s=Object.getPrototypeOf(t);return null===s?void 0:e(s,i,n)}if("value"in r)return r.value;var a=r.get;if(void 0!==a)return a.call(n)},l=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),h=e("../utils/logger.js"),d=n(h),c=e("./loader.js"),f=e("../utils/exception.js"),_=e("../crypto/crypto.js"),p=n(_),m=function(e){function t(e,i){r(this,t);var n=s(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,"xhr-moz-chunked-loader"));return n.TAG="MozChunkedLoader",n._seekHandler=e,n._config=i,n._needStash=!0,n._xhr=null,n._requestAbort=!1,n._contentLength=null,n._receivedLength=0,n._requestURL="",n._bInvaidPwd=!1,n}return a(t,e),l(t,null,[{key:"isSupported",value:function(){try{var e=new XMLHttpRequest;return e.open("GET","https://example.com",!0),e.responseType="moz-chunked-arraybuffer","moz-chunked-arraybuffer"===e.responseType}catch(e){return d.default.w("MozChunkedLoader",e.message),!1}}}]),l(t,[{key:"destroy",value:function(){this.abort(),this._xhr&&(this._xhr.onreadystatechange=null,this._xhr.onprogress=null,this._xhr.onloadend=null,this._xhr.onerror=null,this._xhr=null),u(t.prototype.__proto__||Object.getPrototypeOf(t.prototype),"destroy",this).call(this)}},{key:"open",value:function(e,t){this._dataSource=e,this._range=t,this._receivedLength=0;var i=e.url;this._config.reuseRedirectedURL&&void 0!=e.redirectedURL&&(i=e.redirectedURL);var n=this._seekHandler.getConfig(i,t);this._requestURL=n.url;var r=this._xhr=new XMLHttpRequest;if(r.open("GET",n.url,!0),r.responseType="moz-chunked-arraybuffer",r.onreadystatechange=this._onReadyStateChange.bind(this),r.onprogress=this._onProgress.bind(this),r.onloadend=this._onLoadEnd.bind(this),r.onerror=this._onXhrError.bind(this),e.withCredentials&&r.withCredentials&&(r.withCredentials=!0),"object"===o(n.headers)){var s=n.headers;for(var a in s)s.hasOwnProperty(a)&&r.setRequestHeader(a,s[a])}this._config.date&&r.setRequestHeader("x-amz-date",this._config.date),this._config.auth&&r.setRequestHeader("Authorization",this._config.auth),this._status=c.LoaderStatus.kConnecting,r.send()}},{key:"abort",value:function(){this._bInvaidPwd=!1,this._requestAbort=!0,this._xhr&&this._xhr.abort(),this._status=c.LoaderStatus.kComplete}},{key:"_onReadyStateChange",value:function(e){var t=e.target;if(2===t.readyState){if(void 0!=t.responseURL&&t.responseURL!==this._requestURL&&t.responseURL.length)return;if(0!==t.status&&(t.status<200||t.status>299)){if(this._status=c.LoaderStatus.kError,!this._onError)throw new f.RuntimeException("MozChunkedLoader: Http code invalid, "+t.status+" "+t.statusText);this._onError(c.LoaderErrors.HTTP_STATUS_CODE_INVALID,{code:t.status,msg:t.statusText})}else{this._status=c.LoaderStatus.kBuffering;var i="true"===t.getResponseHeader("Secretive");this.onOpened(i)}}}},{key:"_onProgress",value:function(e){if(this._status!==c.LoaderStatus.kError){null===this._contentLength&&null!==e.total&&0!==e.total&&(this._contentLength=e.total,this._onContentLengthKnown&&this._onContentLengthKnown(this._contentLength));var t=e.target.response,i=this._range.from+this._receivedLength;this._receivedLength+=t.byteLength,this._onDataArrival&&this._onDataArrival(t,i,this._receivedLength)}}},{key:"_onLoadEnd",value:function(e){if(401==e.target.status&&!this._bInvaidPwd){this._bInvaidPwd=!0;var t=e.target.getResponseHeader("WWW-Authenticate"),i=t.indexOf('realm="')+7,n=t.substring(i,t.indexOf(",",i)-1);i=t.indexOf('qop="')+5;var r=t.substring(i,t.indexOf(",",i)-1);r.replace('"',""),i=t.indexOf('nonce="')+7;var s=t.substring(i,t.indexOf('"',i));i=t.indexOf('algorithm="')+11;var a=t.substring(i,t.indexOf(",",i)-1),o=this._config.username,u=this._config.password,l=this._requestURL.substring(this._requestURL.indexOf("/",8),this._requestURL.length),h=p.default.generateUUID(),d=p.default.Digest(o,u,a,n,s,h,"00000001","GET",l,r);this.abort();var f=this._xhr=new XMLHttpRequest;return f.open("GET",this._requestURL,!0),f.responseType="moz-chunked-arraybuffer",f.onreadystatechange=this._onReadyStateChange.bind(this),f.onprogress=this._onProgress.bind(this),f.onloadend=this._onLoadEnd.bind(this),f.onerror=this._onXhrError.bind(this),f.withCredentials=!0,t='Digest username="'+o+'", realm="'+n+'", nonce="'+s+'", uri="'+l+'", algorithm='+a+', response="'+d+'", opaque="5ccc069c403ebaf9f0171e9517f40e41", qop="'+r+'", nc=00000001, cnonce="'+h+'"',f.setRequestHeader("Authorization",t),void f.send()}if(!0===this._requestAbort)return void(this._requestAbort=!1);this._status!==c.LoaderStatus.kError&&(this._status=c.LoaderStatus.kComplete,this._onComplete&&this._onComplete(this._range.from,this._range.from+this._receivedLength-1),this._receivedLength<=0&&200==e.target.status?this._onError&&this._onError("error",{code:-999,msg:"no stream , server disconnected"}):this._onError&&this._onError(c.LoaderErrors.HTTP_STATUS_CODE_INVALID,{code:e.target.status,msg:e.target.statusText}))}},{key:"_onXhrError",value:function(e){this._status=c.LoaderStatus.kError;var t=0,i=null;if(this._contentLength&&e.loaded<this._contentLength?(t=c.LoaderErrors.EARLY_EOF,i={code:-1,msg:"Moz-Chunked stream meet Early-Eof"}):(t=c.LoaderErrors.EXCEPTION,this._receivedLength?(this._receivedLength=0,i={code:-999,msg:"no stream , server disconnected , try to reconnect"}):i={code:-1,msg:e.constructor.name+" "+e.type}),!this._onError)throw new f.RuntimeException(i.msg);this._onError(t,i)}}]),t}(c.BaseLoader);i.default=m},{"../crypto/crypto.js":15,"../utils/exception.js":41,"../utils/logger.js":42,"./loader.js":25}],31:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function r(e,t){if(!e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return!t||"object"!=typeof t&&"function"!=typeof t?e:t}function s(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function, not "+typeof t);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}}),t&&(Object.setPrototypeOf?Object.setPrototypeOf(e,t):e.__proto__=t)}Object.defineProperty(i,"__esModule",{value:!0});var a="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(e){return typeof e}:function(e){return e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},o=function e(t,i,n){null===t&&(t=Function.prototype);var r=Object.getOwnPropertyDescriptor(t,i);if(void 0===r){var s=Object.getPrototypeOf(t);return null===s?void 0:e(s,i,n)}if("value"in r)return r.value;var a=r.get;if(void 0!==a)return a.call(n)},u=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),l=e("../utils/logger.js"),h=function(e){return e&&e.__esModule?e:{default:e}}(l),d=e("./loader.js"),c=e("../utils/exception.js"),f=function(e){function t(e,i){n(this,t);var s=r(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,"xhr-msstream-loader"));return s.TAG="MSStreamLoader",s._seekHandler=e,s._config=i,s._needStash=!0,s._xhr=null,s._reader=null,s._totalRange=null,s._currentRange=null,s._currentRequestURL=null,s._currentRedirectedURL=null,s._contentLength=null,s._receivedLength=0,s._bufferLimit=16777216,s._lastTimeBufferSize=0,s._isReconnecting=!1,s}return s(t,e),u(t,null,[{key:"isSupported",value:function(){try{if(void 0===self.MSStream||void 0===self.MSStreamReader)return!1;var e=new XMLHttpRequest;return e.open("GET","https://example.com",!0),e.responseType="ms-stream","ms-stream"===e.responseType}catch(e){return h.default.w("MSStreamLoader",e.message),!1}}}]),u(t,[{key:"destroy",value:function(){this.isWorking()&&this.abort(),this._reader&&(this._reader.onprogress=null,this._reader.onload=null,this._reader.onerror=null,this._reader=null),this._xhr&&(this._xhr.onreadystatechange=null,this._xhr=null),o(t.prototype.__proto__||Object.getPrototypeOf(t.prototype),"destroy",this).call(this)}},{key:"open",value:function(e,t){this._internalOpen(e,t,!1)}},{key:"_internalOpen",value:function(e,t,i){this._dataSource=e,i?this._currentRange=t:this._totalRange=t;var n=e.url;this._config.reuseRedirectedURL&&(void 0!=this._currentRedirectedURL?n=this._currentRedirectedURL:void 0!=e.redirectedURL&&(n=e.redirectedURL));var r=this._seekHandler.getConfig(n,t);this._currentRequestURL=r.url;var s=this._reader=new self.MSStreamReader;s.onprogress=this._msrOnProgress.bind(this),s.onload=this._msrOnLoad.bind(this),s.onerror=this._msrOnError.bind(this);var o=this._xhr=new XMLHttpRequest;if(o.open("GET",r.url,!0),o.responseType="ms-stream",o.onreadystatechange=this._xhrOnReadyStateChange.bind(this),o.onerror=this._xhrOnError.bind(this),e.withCredentials&&(o.withCredentials=!0),"object"===a(r.headers)){var u=r.headers;for(var l in u)u.hasOwnProperty(l)&&o.setRequestHeader(l,u[l])}this._isReconnecting?this._isReconnecting=!1:this._status=d.LoaderStatus.kConnecting,o.send()}},{key:"abort",value:function(){this._internalAbort(),this._status=d.LoaderStatus.kComplete}},{key:"_internalAbort",value:function(){this._reader&&(1===this._reader.readyState&&this._reader.abort(),this._reader.onprogress=null,this._reader.onload=null,this._reader.onerror=null,this._reader=null),this._xhr&&(this._xhr.abort(),this._xhr.onreadystatechange=null,this._xhr=null)}},{key:"_xhrOnReadyStateChange",value:function(e){var t=e.target;if(2===t.readyState)if(t.status>=200&&t.status<=299){if(this._status=d.LoaderStatus.kBuffering,void 0!=t.responseURL){var i=this._seekHandler.removeURLParameters(t.responseURL);t.responseURL!==this._currentRequestURL&&i!==this._currentRedirectedURL&&(this._currentRedirectedURL=i,this._onURLRedirect&&this._onURLRedirect(i))}var n=t.getResponseHeader("Content-Length");if(null!=n&&null==this._contentLength){var r=parseInt(n);r>0&&(this._contentLength=r,this._onContentLengthKnown&&this._onContentLengthKnown(this._contentLength))}}else{if(this._status=d.LoaderStatus.kError,!this._onError)throw new c.RuntimeException("MSStreamLoader: Http code invalid, "+t.status+" "+t.statusText);this._onError(d.LoaderErrors.HTTP_STATUS_CODE_INVALID,{code:t.status,msg:t.statusText})}else if(3===t.readyState&&t.status>=200&&t.status<=299){this._status=d.LoaderStatus.kBuffering;var s=t.response;this._reader.readAsArrayBuffer(s)}}},{key:"_xhrOnError",value:function(e){this._status=d.LoaderStatus.kError;var t=d.LoaderErrors.EXCEPTION,i={code:-1,msg:e.constructor.name+" "+e.type};if(!this._onError)throw new c.RuntimeException(i.msg);this._onError(t,i)}},{key:"_msrOnProgress",value:function(e){var t=e.target,i=t.result;if(null==i)return void this._doReconnectIfNeeded();var n=i.slice(this._lastTimeBufferSize);this._lastTimeBufferSize=i.byteLength;var r=this._totalRange.from+this._receivedLength;this._receivedLength+=n.byteLength,this._onDataArrival&&this._onDataArrival(n,r,this._receivedLength),i.byteLength>=this._bufferLimit&&(h.default.v(this.TAG,"MSStream buffer exceeded max size near "+(r+n.byteLength)+", reconnecting..."),this._doReconnectIfNeeded())}},{key:"_doReconnectIfNeeded",value:function(){if(null==this._contentLength||this._receivedLength<this._contentLength){this._isReconnecting=!0,this._lastTimeBufferSize=0,this._internalAbort();var e={from:this._totalRange.from+this._receivedLength,to:-1};this._internalOpen(this._dataSource,e,!0)}}},{key:"_msrOnLoad",value:function(e){this._status=d.LoaderStatus.kComplete,this._onComplete&&this._onComplete(this._totalRange.from,this._totalRange.from+this._receivedLength-1)}},{key:"_msrOnError",value:function(e){this._status=d.LoaderStatus.kError;var t=0,i=null;if(this._contentLength&&this._receivedLength<this._contentLength?(t=d.LoaderErrors.EARLY_EOF,i={code:-1,msg:"MSStream meet Early-Eof"}):(t=d.LoaderErrors.EARLY_EOF,i={code:-1,msg:e.constructor.name+" "+e.type}),!this._onError)throw new c.RuntimeException(i.msg);this._onError(t,i)}}]),t}(d.BaseLoader);i.default=f},{"../utils/exception.js":41,"../utils/logger.js":42,"./loader.js":25}],32:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}function s(e,t){if(!e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return!t||"object"!=typeof t&&"function"!=typeof t?e:t}function a(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function, not "+typeof t);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}}),t&&(Object.setPrototypeOf?Object.setPrototypeOf(e,t):e.__proto__=t)}Object.defineProperty(i,"__esModule",{value:!0});var o="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(e){return typeof e}:function(e){return e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},u=function e(t,i,n){null===t&&(t=Function.prototype);var r=Object.getOwnPropertyDescriptor(t,i);if(void 0===r){var s=Object.getPrototypeOf(t);return null===s?void 0:e(s,i,n)}if("value"in r)return r.value;var a=r.get;if(void 0!==a)return a.call(n)},l=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}
}(),h=e("../utils/logger.js"),d=n(h),c=e("./speed-sampler.js"),f=n(c),_=e("./loader.js"),p=e("../utils/exception.js"),m=function(e){function t(e,i){r(this,t);var n=s(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,"xhr-range-loader"));return n.TAG="RangeLoader",n._seekHandler=e,n._config=i,n._needStash=!1,n._chunkSizeKBList=[128,256,384,512,768,1024,1536,2048,3072,4096,5120,6144,7168,8192],n._currentChunkSizeKB=384,n._currentSpeedNormalized=0,n._zeroSpeedChunkCount=0,n._xhr=null,n._speedSampler=new f.default,n._requestAbort=!1,n._waitForTotalLength=!1,n._totalLengthReceived=!1,n._currentRequestURL=null,n._currentRedirectedURL=null,n._currentRequestRange=null,n._totalLength=null,n._contentLength=null,n._receivedLength=0,n._lastTimeLoaded=0,n}return a(t,e),l(t,null,[{key:"isSupported",value:function(){try{var e=new XMLHttpRequest;return e.open("GET","https://example.com",!0),e.responseType="arraybuffer","arraybuffer"===e.responseType}catch(e){return d.default.w("RangeLoader",e.message),!1}}}]),l(t,[{key:"destroy",value:function(){this.isWorking()&&this.abort(),this._xhr&&(this._xhr.onreadystatechange=null,this._xhr.onprogress=null,this._xhr.onload=null,this._xhr.onerror=null,this._xhr=null),u(t.prototype.__proto__||Object.getPrototypeOf(t.prototype),"destroy",this).call(this)}},{key:"open",value:function(e,t){this._dataSource=e,this._range=t,this._status=_.LoaderStatus.kConnecting;var i=!1;void 0!=this._dataSource.filesize&&0!==this._dataSource.filesize&&(i=!0,this._totalLength=this._dataSource.filesize),this._totalLengthReceived||i?this._openSubRange():(this._waitForTotalLength=!0,this._internalOpen(this._dataSource,{from:0,to:-1}))}},{key:"_openSubRange",value:function(){var e=1024*this._currentChunkSizeKB,t=this._range.from+this._receivedLength,i=t+e;null!=this._contentLength&&i-this._range.from>=this._contentLength&&(i=this._range.from+this._contentLength-1),this._currentRequestRange={from:t,to:i},this._internalOpen(this._dataSource,this._currentRequestRange)}},{key:"_internalOpen",value:function(e,t){this._lastTimeLoaded=0;var i=e.url;this._config.reuseRedirectedURL&&(void 0!=this._currentRedirectedURL?i=this._currentRedirectedURL:void 0!=e.redirectedURL&&(i=e.redirectedURL));var n=this._seekHandler.getConfig(i,t);this._currentRequestURL=n.url;var r=this._xhr=new XMLHttpRequest;if(r.open("GET",n.url,!0),r.responseType="arraybuffer",r.onreadystatechange=this._onReadyStateChange.bind(this),r.onprogress=this._onProgress.bind(this),r.onload=this._onLoad.bind(this),r.onerror=this._onXhrError.bind(this),e.withCredentials&&r.withCredentials&&(r.withCredentials=!0),"object"===o(n.headers)){var s=n.headers;for(var a in s)s.hasOwnProperty(a)&&r.setRequestHeader(a,s[a])}r.send()}},{key:"abort",value:function(){this._requestAbort=!0,this._internalAbort(),this._status=_.LoaderStatus.kComplete}},{key:"_internalAbort",value:function(){this._xhr&&(this._xhr.onreadystatechange=null,this._xhr.onprogress=null,this._xhr.onload=null,this._xhr.onerror=null,this._xhr.abort(),this._xhr=null)}},{key:"_onReadyStateChange",value:function(e){var t=e.target;if(2===t.readyState){if(void 0!=t.responseURL){var i=this._seekHandler.removeURLParameters(t.responseURL);t.responseURL!==this._currentRequestURL&&i!==this._currentRedirectedURL&&(this._currentRedirectedURL=i,this._onURLRedirect&&this._onURLRedirect(i))}if(t.status>=200&&t.status<=299){if(this._waitForTotalLength)return;this._status=_.LoaderStatus.kBuffering}else{if(this._status=_.LoaderStatus.kError,!this._onError)throw new p.RuntimeException("RangeLoader: Http code invalid, "+t.status+" "+t.statusText);this._onError(_.LoaderErrors.HTTP_STATUS_CODE_INVALID,{code:t.status,msg:t.statusText})}}}},{key:"_onProgress",value:function(e){if(this._status!==_.LoaderStatus.kError){if(null===this._contentLength){var t=!1;if(this._waitForTotalLength){this._waitForTotalLength=!1,this._totalLengthReceived=!0,t=!0;var i=e.total;this._internalAbort(),null!=i&0!==i&&(this._totalLength=i)}if(-1===this._range.to?this._contentLength=this._totalLength-this._range.from:this._contentLength=this._range.to-this._range.from+1,t)return void this._openSubRange();this._onContentLengthKnown&&this._onContentLengthKnown(this._contentLength)}var n=e.loaded-this._lastTimeLoaded;this._lastTimeLoaded=e.loaded,this._speedSampler.addBytes(n)}}},{key:"_normalizeSpeed",value:function(e){var t=this._chunkSizeKBList,i=t.length-1,n=0,r=0,s=i;if(e<t[0])return t[0];for(;r<=s;){if((n=r+Math.floor((s-r)/2))===i||e>=t[n]&&e<t[n+1])return t[n];t[n]<e?r=n+1:s=n-1}}},{key:"_onLoad",value:function(e){if(this._status!==_.LoaderStatus.kError){if(this._waitForTotalLength)return void(this._waitForTotalLength=!1);this._lastTimeLoaded=0;var t=this._speedSampler.lastSecondKBps;if(0===t&&++this._zeroSpeedChunkCount>=3&&(t=this._speedSampler.currentKBps),0!==t){var i=this._normalizeSpeed(t);this._currentSpeedNormalized!==i&&(this._currentSpeedNormalized=i,this._currentChunkSizeKB=i)}var n=e.target.response,r=this._range.from+this._receivedLength;this._receivedLength+=n.byteLength;var s=!1;null!=this._contentLength&&this._receivedLength<this._contentLength?this._openSubRange():s=!0,this._onDataArrival&&this._onDataArrival(n,r,this._receivedLength),s&&(this._status=_.LoaderStatus.kComplete,this._onComplete&&this._onComplete(this._range.from,this._range.from+this._receivedLength-1))}}},{key:"_onXhrError",value:function(e){this._status=_.LoaderStatus.kError;var t=0,i=null;if(this._contentLength&&this._receivedLength>0&&this._receivedLength<this._contentLength?(t=_.LoaderErrors.EARLY_EOF,i={code:-1,msg:"RangeLoader meet Early-Eof"}):(t=_.LoaderErrors.EXCEPTION,i={code:-1,msg:e.constructor.name+" "+e.type}),!this._onError)throw new p.RuntimeException(i.msg);this._onError(t,i)}},{key:"currentSpeed",get:function(){return this._speedSampler.lastSecondKBps}}]),t}(_.BaseLoader);i.default=m},{"../utils/exception.js":41,"../utils/logger.js":42,"./loader.js":25,"./speed-sampler.js":28}],33:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var s="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(e){return typeof e}:function(e){return e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},a=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),o=e("events"),u=n(o),l=e("../utils/logger.js"),h=n(l),d=e("../utils/browser.js"),c=n(d),f=e("./player-events.js"),_=n(f),p=e("../core/transmuxer.js"),m=n(p),v=e("../core/transmuxing-events.js"),g=n(v),y=e("../core/mse-controller.js"),b=n(y),E=e("../core/mse-events.js"),S=n(E),k=e("./player-errors.js"),w=e("../config.js"),L=e("../utils/exception.js"),R=function(){function e(t,i){if(r(this,e),this.TAG="FlvPlayer",this._type="FlvPlayer",this._emitter=new u.default,this._config=(0,w.createDefaultConfig)(),"object"===(void 0===i?"undefined":s(i))&&Object.assign(this._config,i),"flv"!==t.type.toLowerCase())throw new L.InvalidArgumentException("FlvPlayer requires an flv MediaDataSource input!");!0===t.isLive&&(this._config.isLive=!0),this.e={onvLoadedMetadata:this._onvLoadedMetadata.bind(this),onvSeeking:this._onvSeeking.bind(this),onvCanPlay:this._onvCanPlay.bind(this),onvStalled:this._onvStalled.bind(this),onvProgress:this._onvProgress.bind(this),onvTimeUpdate:this._onvTimeUpdate.bind(this)},self.performance&&self.performance.now?this._now=self.performance.now.bind(self.performance):this._now=Date.now,this._pendingSeekTime=null,this._requestSetTime=!1,this._seekpointRecord=null,this._progressChecker=null,this._mediaDataSource=t,this._mediaElement=null,this._msectl=null,this._transmuxer=null,this._mseSourceOpened=!1,this._hasPendingLoad=!1,this._receivedCanPlay=!1,this._mediaInfo=null,this._statisticsInfo=null,this._processStateCount=0;var n=c.default.chrome&&(c.default.version.major<50||50===c.default.version.major&&c.default.version.build<2661);this._alwaysSeekKeyframe=!!(n||c.default.msedge||c.default.msie),this._alwaysSeekKeyframe&&(this._config.accurateSeek=!1),this._streamTimer=null}return a(e,[{key:"destroy",value:function(){null!=this._progressChecker&&(window.clearInterval(this._progressChecker),this._progressChecker=null),this._transmuxer&&this.unload(),this._mediaElement&&this.detachMediaElement(),this.e=null,this._mediaDataSource=null,this._emitter.removeAllListeners(),this._emitter=null,this._processStateCount=0}},{key:"on",value:function(e,t){var i=this;e===_.default.MEDIA_INFO?null!=this._mediaInfo&&Promise.resolve().then(function(){i._emitter.emit(_.default.MEDIA_INFO,i.mediaInfo)}):e===_.default.STATISTICS_INFO&&null!=this._statisticsInfo&&Promise.resolve().then(function(){i._emitter.emit(_.default.STATISTICS_INFO,i.statisticsInfo)}),this._emitter.addListener(e,t)}},{key:"off",value:function(e,t){this._emitter.removeListener(e,t)}},{key:"attachMediaElement",value:function(e){var t=this;if(this._processStateCount=0,this._mediaElement=e,e.addEventListener("loadedmetadata",this.e.onvLoadedMetadata),e.addEventListener("seeking",this.e.onvSeeking),e.addEventListener("canplay",this.e.onvCanPlay),e.addEventListener("stalled",this.e.onvStalled),e.addEventListener("progress",this.e.onvProgress),e.addEventListener("timeupdate",this.e.onvTimeUpdate),this._msectl=new b.default(this._config),this._msectl.on(S.default.UPDATE_END,this._onmseUpdateEnd.bind(this)),this._msectl.on(S.default.BUFFER_FULL,this._onmseBufferFull.bind(this)),this._msectl.on(S.default.SOURCE_OPEN,function(){t._mseSourceOpened=!0,t._hasPendingLoad&&(t._hasPendingLoad=!1,t.load())}),this._msectl.on(S.default.ERROR,function(e){t._emitter.emit(_.default.ERROR,k.ErrorTypes.MEDIA_ERROR,k.ErrorDetails.MEDIA_MSE_ERROR,e)}),this._msectl.attachMediaElement(e),null!=this._pendingSeekTime)try{e.currentTime=this._pendingSeekTime,this._pendingSeekTime=null}catch(e){}}},{key:"detachMediaElement",value:function(){this._mediaElement&&(this._msectl.detachMediaElement(),this._mediaElement.removeEventListener("loadedmetadata",this.e.onvLoadedMetadata),this._mediaElement.removeEventListener("seeking",this.e.onvSeeking),this._mediaElement.removeEventListener("canplay",this.e.onvCanPlay),this._mediaElement.removeEventListener("stalled",this.e.onvStalled),this._mediaElement.removeEventListener("progress",this.e.onvProgress),this._mediaElement.removeEventListener("timeupdate",this.e.onvTimeUpdate),this._mediaElement=null),this._msectl&&(this._msectl.destroy(),this._msectl=null),this._streamTimer&&(clearInterval(this._streamTimer),this._streamTimer=null)}},{key:"load",value:function(){var e=this;if(!this._mediaElement)throw new L.IllegalStateException("HTMLMediaElement must be attached before load()!");if(this._transmuxer)throw new L.IllegalStateException("FlvPlayer.load() has been called, please call unload() first!");if(!this._hasPendingLoad){if(this._config.deferLoadAfterSourceOpen&&!1===this._mseSourceOpened)return void(this._hasPendingLoad=!0);this._mediaElement.readyState>0&&(this._requestSetTime=!0,this._mediaElement.currentTime=0),this._transmuxer=new m.default(this._mediaDataSource,this._config),this._transmuxer.on(g.default.INIT_SEGMENT,function(t,i){e._msectl.appendInitSegment(i)}),this._transmuxer.on(g.default.MEDIA_SEGMENT,function(t,i){if(e._msectl.appendMediaSegment(i),e._config.lazyLoad&&!e._config.isLive){var n=e._mediaElement.currentTime;i.info.endDts>=1e3*(n+e._config.lazyLoadMaxDuration)&&null==e._progressChecker&&(h.default.v(e.TAG,"Maximum buffering duration exceeded, suspend transmuxing task"),e._suspendTransmuxer())}}),this._transmuxer.on(g.default.LOADING_COMPLETE,function(){e._msectl.endOfStream(),e._emitter.emit(_.default.LOADING_COMPLETE)}),this._transmuxer.on(g.default.RECOVERED_EARLY_EOF,function(){e._emitter.emit(_.default.RECOVERED_EARLY_EOF)}),this._transmuxer.on(g.default.IO_ERROR,function(t,i){e._emitter.emit(_.default.ERROR,k.ErrorTypes.NETWORK_ERROR,t,i)}),this._transmuxer.on(g.default.DEMUX_ERROR,function(t,i){e._emitter.emit(_.default.ERROR,k.ErrorTypes.MEDIA_ERROR,t,{code:-1,msg:i})}),this._transmuxer.on(g.default.MEDIA_INFO,function(t){e._mediaInfo=t,e._emitter.emit(_.default.MEDIA_INFO,Object.assign({},t))}),this._transmuxer.on(g.default.STATISTICS_INFO,function(t){e._statisticsInfo=e._fillStatisticsInfo(t),e._emitter.emit(_.default.STATISTICS_INFO,Object.assign({},e._statisticsInfo))}),this._transmuxer.on(g.default.RECOMMEND_SEEKPOINT,function(t){e._mediaElement&&!e._config.accurateSeek&&(e._requestSetTime=!0,e._mediaElement.currentTime=t/1e3)}),this._transmuxer.open()}}},{key:"unload",value:function(){this._mediaElement&&this._mediaElement.pause(),this._msectl&&this._msectl.seek(0),this._transmuxer&&(this._transmuxer.close(),this._transmuxer.destroy(),this._transmuxer=null)}},{key:"play",value:function(){return this._mediaElement.play()}},{key:"pause",value:function(){this._mediaElement.pause()}},{key:"resume",value:function(e){if(e&&(this._mediaDataSource.url=e),this._config.isLive){var t=this._mediaElement;this.unload(),this.detachMediaElement(),this.attachMediaElement(t),this.load(),this.play()}else{var i=function(e,t){return(Array(t).join("0")+e).slice(-t)},n=this._mediaDataSource.url,r=this._mediaElement.currentTime,s=n.indexOf("starttime=")+10,a=n.substring(s,s+15),o=(n.substring(0,s),n.substring(s+15,n.length),a.substring(0,4)),u=a.substring(4,6),l=a.substring(6,8),h=a.substring(9,11),d=a.substring(11,13),c=a.substring(13,15),f=new Date(o,u,l,h,d,c,0),_=Date.parse(f);_+=1e3*r;var p=new Date(_),m=i(p.getFullYear(),4)+i(p.getMonth(),2)+i(p.getDate(),2)+"T"+i(p.getHours(),2)+i(p.getMinutes(),2)+i(p.getSeconds(),2);n=n.replace(a,m),console.log("zlplayer resume playback currenttime "+this._mediaElement.currentTime+" timestamp "+_+" with url"+n);var v=this._mediaDataSource;this._config;v.url=n;var g=this._mediaElement;this.unload(),this.detachMediaElement(),this.attachMediaElement(g),this.load(),this.play()}}},{key:"_fillStatisticsInfo",value:function(e){if(e.playerType=this._type,!(this._mediaElement instanceof HTMLVideoElement))return e;var t=!0,i=0,n=0;if(this._mediaElement.getVideoPlaybackQuality){var r=this._mediaElement.getVideoPlaybackQuality();i=r.totalVideoFrames,n=r.droppedVideoFrames}else void 0!=this._mediaElement.webkitDecodedFrameCount?(i=this._mediaElement.webkitDecodedFrameCount,n=this._mediaElement.webkitDroppedFrameCount):t=!1;return t&&(e.decodedFrames=i,e.droppedFrames=n),e}},{key:"_onmseUpdateEnd",value:function(){if(this._config.lazyLoad&&!this._config.isLive){for(var e=this._mediaElement.buffered,t=this._mediaElement.currentTime,i=0,n=0;n<e.length;n++){var r=e.start(n),s=e.end(n);if(r<=t&&t<s){r,i=s;break}}i>=t+this._config.lazyLoadMaxDuration&&null==this._progressChecker&&(h.default.v(this.TAG,"Maximum buffering duration exceeded, suspend transmuxing task"),this._suspendTransmuxer())}}},{key:"_onmseBufferFull",value:function(){h.default.v(this.TAG,"MSE SourceBuffer is full, suspend transmuxing task"),null==this._progressChecker&&this._suspendTransmuxer()}},{key:"_suspendTransmuxer",value:function(){this._transmuxer&&(this._transmuxer.pause(),null==this._progressChecker&&(this._progressChecker=window.setInterval(this._checkProgressAndResume.bind(this),1e3)))}},{key:"_checkProgressAndResume",value:function(){var e=this._mediaElement.currentTime,t=this._mediaElement.buffered,i=!1;if(this._config.lazyLoad)for(var n=0;n<t.length;n++){var r=t.start(n),s=t.end(n);if(e>=r&&e<s){e>=s-this._config.lazyLoadRecoverDuration&&(i=!0);break}}i&&(window.clearInterval(this._progressChecker),this._progressChecker=null,i&&(h.default.v(this.TAG,"Continue loading from paused position"),this._transmuxer.resume()))}},{key:"_isTimepointBuffered",value:function(e){for(var t=this._mediaElement.buffered,i=0;i<t.length;i++){var n=t.start(i),r=t.end(i);if(e>=n&&e<r)return!0}return!1}},{key:"_internalSeek",value:function(e){var t=this._isTimepointBuffered(e),i=!1,n=0;if(e<1&&this._mediaElement.buffered.length>0){var r=this._mediaElement.buffered.start(0);(r<1&&e<r||c.default.safari)&&(i=!0,n=c.default.safari?.1:r)}if(i)this._requestSetTime=!0,this._mediaElement.currentTime=n;else if(t){if(this._alwaysSeekKeyframe){var s=this._msectl.getNearestKeyframe(Math.floor(1e3*e));this._requestSetTime=!0,this._mediaElement.currentTime=null!=s?s.dts/1e3:e}else this._requestSetTime=!0,this._mediaElement.currentTime=e;null!=this._progressChecker&&this._checkProgressAndResume()}else null!=this._progressChecker&&(window.clearInterval(this._progressChecker),this._progressChecker=null),this._msectl.seek(e),this._transmuxer.seek(Math.floor(1e3*e)),this._config.accurateSeek&&(this._requestSetTime=!0,this._mediaElement.currentTime=e)}},{key:"_checkAndApplyUnbufferedSeekpoint",value:function(){if(this._seekpointRecord)if(this._seekpointRecord.recordTime<=this._now()-100){var e=this._mediaElement.currentTime;this._seekpointRecord=null,this._isTimepointBuffered(e)||(null!=this._progressChecker&&(window.clearTimeout(this._progressChecker),this._progressChecker=null),this._msectl.seek(e),this._transmuxer.seek(Math.floor(1e3*e)),this._config.accurateSeek&&(this._requestSetTime=!0,this._mediaElement.currentTime=e))}else window.setTimeout(this._checkAndApplyUnbufferedSeekpoint.bind(this),50)}},{key:"_checkAndResumeStuckPlayback",value:function(e){var t=this._mediaElement;if(e||!this._receivedCanPlay||t.readyState<2){var i=t.buffered;if(i.length>0&&t.currentTime<i.start(0))return h.default.w(this.TAG,"Playback seems stuck at "+t.currentTime+", seek to "+i.start(0)),this._requestSetTime=!0,void(this._mediaElement.currentTime=i.start(0))}if(this._config.isLive&&this._receivedCanPlay){if(t.readyState>2&&this._config.isLive){var n=t.buffered;if(n.length>0){var r=n.end(n.length-1);r>this._mediaElement.currentTime+3&&this._mediaElement.playbackRate<1.2?(console.log("checked buffer is more than 3s, play fast to reduce delay"),this._mediaElement.playbackRate=1.5):r<this._mediaElement.currentTime+1&&this._mediaElement.playbackRate>1.2&&(console.log("checked buffer is less than 1 s, play with normal speed"),this._mediaElement.playbackRate=1)}}if(this._streamTimeFlag=(new Date).getTime(),!this._streamTimer&&this._config.isLive&&this._mediaElement.readyState>2&&(this._streamTimer=setInterval(function(){(new Date).getTime()-this._streamTimeFlag>5e3&&(console.warn("zlplayer: stream timeout(5000ms) replay it"),this._emitter.emit(_.default.ERROR,k.ErrorTypes.MEDIA_ERROR,k.ErrorDetails.NEED_REPLAY,"stream timeout need replay"))}.bind(this),3e3)),++this._processStateCount>10&&(console.warn("zlplayer: checked play stucked"),this._config.isLive)){var s=this._mediaElement.buffered;if(s.length>0){var a=s.end(s.length-1);a>this._mediaElement.currentTime+1&&(console.log("zlplayer: seek to buffered time "+a),this._mediaElement.currentTime=a)}}}}},{key:"_onvLoadedMetadata",value:function(e){null!=this._pendingSeekTime&&(this._mediaElement.currentTime=this._pendingSeekTime,this._pendingSeekTime=null)}},{key:"_onvSeeking",value:function(e){var t=this._mediaElement.currentTime,i=this._mediaElement.buffered;if(this._requestSetTime)return void(this._requestSetTime=!1);if(t<1&&i.length>0){var n=i.start(0);if(n<1&&t<n||c.default.safari)return this._requestSetTime=!0,void(this._mediaElement.currentTime=c.default.safari?.1:n)}if(this._isTimepointBuffered(t)){if(this._alwaysSeekKeyframe){var r=this._msectl.getNearestKeyframe(Math.floor(1e3*t));null!=r&&(this._requestSetTime=!0,this._mediaElement.currentTime=r.dts/1e3)}return void(null!=this._progressChecker&&this._checkProgressAndResume())}}},{key:"_onvCanPlay",value:function(e){this._receivedCanPlay=!0,this._mediaElement.removeEventListener("canplay",this.e.onvCanPlay)}},{key:"_onvStalled",value:function(e){this._checkAndResumeStuckPlayback(!0)}},{key:"_onvProgress",value:function(e){this._checkAndResumeStuckPlayback()}},{key:"_onvTimeUpdate",value:function(e){this._processStateCount=0}},{key:"type",get:function(){return this._type}},{key:"buffered",get:function(){return this._mediaElement.buffered}},{key:"duration",get:function(){return this._mediaElement.duration}},{key:"volume",get:function(){return this._mediaElement.volume},set:function(e){this._mediaElement.volume=e}},{key:"muted",get:function(){return this._mediaElement.muted},set:function(e){this._mediaElement.muted=e}},{key:"currentTime",get:function(){return this._mediaElement?this._mediaElement.currentTime:0},set:function(e){this._mediaElement?this._internalSeek(e):this._pendingSeekTime=e}},{key:"mediaInfo",get:function(){return Object.assign({},this._mediaInfo)}},{key:"statisticsInfo",get:function(){return null==this._statisticsInfo&&(this._statisticsInfo={}),this._statisticsInfo=this._fillStatisticsInfo(this._statisticsInfo),Object.assign({},this._statisticsInfo)}}]),e}();i.default=R},{"../config.js":5,"../core/mse-controller.js":9,"../core/mse-events.js":10,"../core/transmuxer.js":11,"../core/transmuxing-events.js":13,"../utils/browser.js":40,"../utils/exception.js":41,"../utils/logger.js":42,"./player-errors.js":35,"./player-events.js":36,events:2}],34:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var s="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(e){return typeof e}:function(e){return e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},a=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),o=e("events"),u=n(o),l=e("./player-events.js"),h=n(l),d=e("../config.js"),c=e("../utils/exception.js"),f=function(){function e(t,i){if(r(this,e),this.TAG="NativePlayer",this._type="NativePlayer",this._emitter=new u.default,this._config=(0,d.createDefaultConfig)(),"object"===(void 0===i?"undefined":s(i))&&Object.assign(this._config,i),"flv"===t.type.toLowerCase())throw new c.InvalidArgumentException("NativePlayer does't support flv MediaDataSource input!");if(t.hasOwnProperty("segments"))throw new c.InvalidArgumentException("NativePlayer("+t.type+") doesn't support multipart playback!");this.e={onvLoadedMetadata:this._onvLoadedMetadata.bind(this)},this._pendingSeekTime=null,this._statisticsReporter=null,this._mediaDataSource=t,this._mediaElement=null}return a(e,[{key:"destroy",value:function(){this._mediaElement&&(this.unload(),this.detachMediaElement()),this.e=null,this._mediaDataSource=null,this._emitter.removeAllListeners(),this._emitter=null}},{key:"on",value:function(e,t){var i=this;e===h.default.MEDIA_INFO?null!=this._mediaElement&&0!==this._mediaElement.readyState&&Promise.resolve().then(function(){i._emitter.emit(h.default.MEDIA_INFO,i.mediaInfo)}):e===h.default.STATISTICS_INFO&&null!=this._mediaElement&&0!==this._mediaElement.readyState&&Promise.resolve().then(function(){i._emitter.emit(h.default.STATISTICS_INFO,i.statisticsInfo)}),this._emitter.addListener(e,t)}},{key:"off",value:function(e,t){this._emitter.removeListener(e,t)}},{key:"attachMediaElement",value:function(e){if(this._mediaElement=e,e.addEventListener("loadedmetadata",this.e.onvLoadedMetadata),null!=this._pendingSeekTime)try{e.currentTime=this._pendingSeekTime,this._pendingSeekTime=null}catch(e){}}},{key:"detachMediaElement",value:function(){this._mediaElement&&(this._mediaElement.src="",this._mediaElement.removeAttribute("src"),this._mediaElement.removeEventListener("loadedmetadata",this.e.onvLoadedMetadata),this._mediaElement=null),null!=this._statisticsReporter&&(window.clearInterval(this._statisticsReporter),this._statisticsReporter=null)}},{key:"load",value:function(){if(!this._mediaElement)throw new c.IllegalStateException("HTMLMediaElement must be attached before load()!");this._mediaElement.src=this._mediaDataSource.url,this._mediaElement.readyState>0&&(this._mediaElement.currentTime=0),this._mediaElement.preload="auto",this._mediaElement.load(),this._statisticsReporter=window.setInterval(this._reportStatisticsInfo.bind(this),this._config.statisticsInfoReportInterval)}},{key:"unload",value:function(){this._mediaElement&&(this._mediaElement.src="",this._mediaElement.removeAttribute("src")),null!=this._statisticsReporter&&(window.clearInterval(this._statisticsReporter),this._statisticsReporter=null)}},{key:"play",value:function(){return this._mediaElement.play()}},{key:"pause",value:function(){this._mediaElement.pause()}},{key:"_onvLoadedMetadata",value:function(e){null!=this._pendingSeekTime&&(this._mediaElement.currentTime=this._pendingSeekTime,this._pendingSeekTime=null),this._emitter.emit(h.default.MEDIA_INFO,this.mediaInfo)}},{key:"_reportStatisticsInfo",value:function(){this._emitter.emit(h.default.STATISTICS_INFO,this.statisticsInfo)}},{key:"type",get:function(){return this._type}},{key:"buffered",get:function(){return this._mediaElement.buffered}},{key:"duration",get:function(){return this._mediaElement.duration}},{key:"volume",get:function(){return this._mediaElement.volume},set:function(e){this._mediaElement.volume=e}},{key:"muted",get:function(){return this._mediaElement.muted},set:function(e){this._mediaElement.muted=e}},{key:"currentTime",get:function(){return this._mediaElement?this._mediaElement.currentTime:0},set:function(e){this._mediaElement?this._mediaElement.currentTime=e:this._pendingSeekTime=e}},{key:"mediaInfo",get:function(){var e=this._mediaElement instanceof HTMLAudioElement?"audio/":"video/",t={mimeType:e+this._mediaDataSource.type};return this._mediaElement&&(t.duration=Math.floor(1e3*this._mediaElement.duration),this._mediaElement instanceof HTMLVideoElement&&(t.width=this._mediaElement.videoWidth,t.height=this._mediaElement.videoHeight)),t}},{key:"statisticsInfo",get:function(){var e={playerType:this._type,url:this._mediaDataSource.url};if(!(this._mediaElement instanceof HTMLVideoElement))return e;var t=!0,i=0,n=0;if(this._mediaElement.getVideoPlaybackQuality){var r=this._mediaElement.getVideoPlaybackQuality();i=r.totalVideoFrames,n=r.droppedVideoFrames}else void 0!=this._mediaElement.webkitDecodedFrameCount?(i=this._mediaElement.webkitDecodedFrameCount,n=this._mediaElement.webkitDroppedFrameCount):t=!1;return t&&(e.decodedFrames=i,e.droppedFrames=n),e}}]),e}();i.default=f},{"../config.js":5,"../utils/exception.js":41,"./player-events.js":36,events:2}],35:[function(e,t,i){"use strict";Object.defineProperty(i,"__esModule",{value:!0}),i.ErrorDetails=i.ErrorTypes=void 0;var n=e("../io/loader.js"),r=e("../demux/demux-errors.js"),s=function(e){return e&&e.__esModule?e:{default:e}}(r);i.ErrorTypes={NETWORK_ERROR:"NetworkError",MEDIA_ERROR:"MediaError",OTHER_ERROR:"OtherError"},i.ErrorDetails={NETWORK_EXCEPTION:n.LoaderErrors.EXCEPTION,NETWORK_STATUS_CODE_INVALID:n.LoaderErrors.HTTP_STATUS_CODE_INVALID,NETWORK_TIMEOUT:n.LoaderErrors.CONNECTING_TIMEOUT,NETWORK_UNRECOVERABLE_EARLY_EOF:n.LoaderErrors.UNRECOVERABLE_EARLY_EOF,MEDIA_MSE_ERROR:"MediaMSEError",MEDIA_FORMAT_ERROR:s.default.FORMAT_ERROR,MEDIA_FORMAT_UNSUPPORTED:s.default.FORMAT_UNSUPPORTED,MEDIA_CODEC_UNSUPPORTED:s.default.CODEC_UNSUPPORTED,NEED_REPLAY:"NeedReplay"}},{"../demux/demux-errors.js":17,"../io/loader.js":25}],36:[function(e,t,i){"use strict";Object.defineProperty(i,"__esModule",{value:!0});var n={ERROR:"error",LOADING_COMPLETE:"loading_complete",RECOVERED_EARLY_EOF:"recovered_early_eof",MEDIA_INFO:"media_info",STATISTICS_INFO:"statistics_info"};i.default=n},{}],37:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var r=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),s=function(){function e(){n(this,e)}return r(e,null,[{key:"getSilentFrame",value:function(e,t){if("mp4a.40.2"===e){if(1===t)return new Uint8Array([0,200,0,128,35,128]);if(2===t)return new Uint8Array([33,0,73,144,2,25,0,35,128]);if(3===t)return new Uint8Array([0,200,0,128,32,132,1,38,64,8,100,0,142]);if(4===t)return new Uint8Array([0,200,0,128,32,132,1,38,64,8,100,0,128,44,128,8,2,56]);if(5===t)return new Uint8Array([0,200,0,128,32,132,1,38,64,8,100,0,130,48,4,153,0,33,144,2,56]);if(6===t)return new Uint8Array([0,200,0,128,32,132,1,38,64,8,100,0,130,48,4,153,0,33,144,2,0,178,0,32,8,224])}else{if(1===t)return new Uint8Array([1,64,34,128,163,78,230,128,186,8,0,0,0,28,6,241,193,10,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,94]);if(2===t)return new Uint8Array([1,64,34,128,163,94,230,128,186,8,0,0,0,0,149,0,6,241,161,10,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,94]);if(3===t)return new Uint8Array([1,64,34,128,163,94,230,128,186,8,0,0,0,0,149,0,6,241,161,10,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,94])}return null}}]),e}();i.default=s},{}],38:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var r=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),s=function(){function e(){n(this,e)}return r(e,null,[{key:"init",value:function(){e.types={avc1:[],avcC:[],btrt:[],dinf:[],dref:[],esds:[],ftyp:[],hdlr:[],mdat:[],mdhd:[],mdia:[],mfhd:[],minf:[],moof:[],moov:[],mp4a:[],mvex:[],mvhd:[],sdtp:[],stbl:[],stco:[],stsc:[],stsd:[],stsz:[],stts:[],tfdt:[],tfhd:[],traf:[],trak:[],trun:[],trex:[],tkhd:[],vmhd:[],smhd:[],".mp3":[]};for(var t in e.types)e.types.hasOwnProperty(t)&&(e.types[t]=[t.charCodeAt(0),t.charCodeAt(1),t.charCodeAt(2),t.charCodeAt(3)]);var i=e.constants={};i.FTYP=new Uint8Array([105,115,111,109,0,0,0,1,105,115,111,109,97,118,99,49]),i.STSD_PREFIX=new Uint8Array([0,0,0,0,0,0,0,1]),i.STTS=new Uint8Array([0,0,0,0,0,0,0,0]),i.STSC=i.STCO=i.STTS,i.STSZ=new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0]),i.HDLR_VIDEO=new Uint8Array([0,0,0,0,0,0,0,0,118,105,100,101,0,0,0,0,0,0,0,0,0,0,0,0,86,105,100,101,111,72,97,110,100,108,101,114,0]),i.HDLR_AUDIO=new Uint8Array([0,0,0,0,0,0,0,0,115,111,117,110,0,0,0,0,0,0,0,0,0,0,0,0,83,111,117,110,100,72,97,110,100,108,101,114,0]),i.DREF=new Uint8Array([0,0,0,0,0,0,0,1,0,0,0,12,117,114,108,32,0,0,0,1]),i.SMHD=new Uint8Array([0,0,0,0,0,0,0,0]),i.VMHD=new Uint8Array([0,0,0,1,0,0,0,0,0,0,0,0])}},{key:"box",value:function(e){for(var t=8,i=null,n=Array.prototype.slice.call(arguments,1),r=n.length,s=0;s<r;s++)t+=n[s].byteLength;i=new Uint8Array(t),i[0]=t>>>24&255,i[1]=t>>>16&255,i[2]=t>>>8&255,i[3]=255&t,i.set(e,4);for(var a=8,o=0;o<r;o++)i.set(n[o],a),a+=n[o].byteLength;return i}},{key:"generateInitSegment",value:function(t){var i=e.box(e.types.ftyp,e.constants.FTYP),n=e.moov(t),r=new Uint8Array(i.byteLength+n.byteLength);return r.set(i,0),r.set(n,i.byteLength),r}},{key:"moov",value:function(t){var i=e.mvhd(t.timescale,t.duration),n=e.trak(t),r=e.mvex(t);return e.box(e.types.moov,i,n,r)}},{key:"mvhd",value:function(t,i){
return e.box(e.types.mvhd,new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,t>>>24&255,t>>>16&255,t>>>8&255,255&t,i>>>24&255,i>>>16&255,i>>>8&255,255&i,0,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,64,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,255,255,255]))}},{key:"trak",value:function(t){return e.box(e.types.trak,e.tkhd(t),e.mdia(t))}},{key:"tkhd",value:function(t){var i=t.id,n=t.duration,r=t.presentWidth,s=t.presentHeight;return e.box(e.types.tkhd,new Uint8Array([0,0,0,7,0,0,0,0,0,0,0,0,i>>>24&255,i>>>16&255,i>>>8&255,255&i,0,0,0,0,n>>>24&255,n>>>16&255,n>>>8&255,255&n,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,64,0,0,0,r>>>8&255,255&r,0,0,s>>>8&255,255&s,0,0]))}},{key:"mdia",value:function(t){return e.box(e.types.mdia,e.mdhd(t),e.hdlr(t),e.minf(t))}},{key:"mdhd",value:function(t){var i=t.timescale,n=t.duration;return e.box(e.types.mdhd,new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,i>>>24&255,i>>>16&255,i>>>8&255,255&i,n>>>24&255,n>>>16&255,n>>>8&255,255&n,85,196,0,0]))}},{key:"hdlr",value:function(t){var i=null;return i="audio"===t.type?e.constants.HDLR_AUDIO:e.constants.HDLR_VIDEO,e.box(e.types.hdlr,i)}},{key:"minf",value:function(t){var i=null;return i="audio"===t.type?e.box(e.types.smhd,e.constants.SMHD):e.box(e.types.vmhd,e.constants.VMHD),e.box(e.types.minf,i,e.dinf(),e.stbl(t))}},{key:"dinf",value:function(){return e.box(e.types.dinf,e.box(e.types.dref,e.constants.DREF))}},{key:"stbl",value:function(t){return e.box(e.types.stbl,e.stsd(t),e.box(e.types.stts,e.constants.STTS),e.box(e.types.stsc,e.constants.STSC),e.box(e.types.stsz,e.constants.STSZ),e.box(e.types.stco,e.constants.STCO))}},{key:"stsd",value:function(t){return"audio"===t.type?"mp3"===t.codec?e.box(e.types.stsd,e.constants.STSD_PREFIX,e.mp3(t)):e.box(e.types.stsd,e.constants.STSD_PREFIX,e.mp4a(t)):e.box(e.types.stsd,e.constants.STSD_PREFIX,e.avc1(t))}},{key:"mp3",value:function(t){var i=t.channelCount,n=t.audioSampleRate,r=new Uint8Array([0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,i,0,16,0,0,0,0,n>>>8&255,255&n,0,0]);return e.box(e.types[".mp3"],r)}},{key:"mp4a",value:function(t){var i=t.channelCount,n=t.audioSampleRate,r=new Uint8Array([0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,i,0,16,0,0,0,0,n>>>8&255,255&n,0,0]);return e.box(e.types.mp4a,r,e.esds(t))}},{key:"esds",value:function(t){var i=t.config||[],n=i.length,r=new Uint8Array([0,0,0,0,3,23+n,0,1,0,4,15+n,64,21,0,0,0,0,0,0,0,0,0,0,0,5].concat([n]).concat(i).concat([6,1,2]));return e.box(e.types.esds,r)}},{key:"avc1",value:function(t){var i=t.avcc,n=t.codecWidth,r=t.codecHeight,s=new Uint8Array([0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,n>>>8&255,255&n,r>>>8&255,255&r,0,72,0,0,0,72,0,0,0,0,0,0,0,1,10,120,113,113,47,102,108,118,46,106,115,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,24,255,255]);return e.box(e.types.avc1,s,e.box(e.types.avcC,i))}},{key:"mvex",value:function(t){return e.box(e.types.mvex,e.trex(t))}},{key:"trex",value:function(t){var i=t.id,n=new Uint8Array([0,0,0,0,i>>>24&255,i>>>16&255,i>>>8&255,255&i,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,1]);return e.box(e.types.trex,n)}},{key:"moof",value:function(t,i){return e.box(e.types.moof,e.mfhd(t.sequenceNumber),e.traf(t,i))}},{key:"mfhd",value:function(t){var i=new Uint8Array([0,0,0,0,t>>>24&255,t>>>16&255,t>>>8&255,255&t]);return e.box(e.types.mfhd,i)}},{key:"traf",value:function(t,i){var n=t.id,r=e.box(e.types.tfhd,new Uint8Array([0,0,0,0,n>>>24&255,n>>>16&255,n>>>8&255,255&n])),s=e.box(e.types.tfdt,new Uint8Array([0,0,0,0,i>>>24&255,i>>>16&255,i>>>8&255,255&i])),a=e.sdtp(t),o=e.trun(t,a.byteLength+16+16+8+16+8+8);return e.box(e.types.traf,r,s,o,a)}},{key:"sdtp",value:function(t){for(var i=t.samples||[],n=i.length,r=new Uint8Array(4+n),s=0;s<n;s++){var a=i[s].flags;r[s+4]=a.isLeading<<6|a.dependsOn<<4|a.isDependedOn<<2|a.hasRedundancy}return e.box(e.types.sdtp,r)}},{key:"trun",value:function(t,i){var n=t.samples||[],r=n.length,s=12+16*r,a=new Uint8Array(s);i+=8+s,a.set([0,0,15,1,r>>>24&255,r>>>16&255,r>>>8&255,255&r,i>>>24&255,i>>>16&255,i>>>8&255,255&i],0);for(var o=0;o<r;o++){var u=n[o].duration,l=n[o].size,h=n[o].flags,d=n[o].cts;a.set([u>>>24&255,u>>>16&255,u>>>8&255,255&u,l>>>24&255,l>>>16&255,l>>>8&255,255&l,h.isLeading<<2|h.dependsOn,h.isDependedOn<<6|h.hasRedundancy<<4|h.isNonSync,0,0,d>>>24&255,d>>>16&255,d>>>8&255,255&d],12+16*o)}return e.box(e.types.trun,a)}},{key:"mdat",value:function(t){return e.box(e.types.mdat,t)}}]),e}();s.init(),i.default=s},{}],39:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var s=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),a=e("../utils/logger.js"),o=n(a),u=e("./mp4-generator.js"),l=n(u),h=e("./aac-silent.js"),d=n(h),c=e("../utils/browser.js"),f=n(c),_=e("../core/media-segment-info.js"),p=e("../utils/exception.js"),m=function(){function e(t){r(this,e),this.TAG="MP4Remuxer",this._config=t,this._isLive=!0===t.isLive,this._dtsBase=-1,this._dtsBaseInited=!1,this._audioDtsBase=1/0,this._videoDtsBase=1/0,this._audioNextDts=void 0,this._videoNextDts=void 0,this._audioMeta=null,this._videoMeta=null,this._audioSegmentInfoList=new _.MediaSegmentInfoList("audio"),this._videoSegmentInfoList=new _.MediaSegmentInfoList("video"),this._onInitSegment=null,this._onMediaSegment=null,this._forceFirstIDR=!(!f.default.chrome||!(f.default.version.major<50||50===f.default.version.major&&f.default.version.build<2661)),this._fillSilentAfterSeek=f.default.msedge||f.default.msie,this._mp3UseMpegAudio=!f.default.firefox,this._fillAudioTimestampGap=this._config.fixAudioTimestampGap}return s(e,[{key:"destroy",value:function(){this._dtsBase=-1,this._dtsBaseInited=!1,this._audioMeta=null,this._videoMeta=null,this._audioSegmentInfoList.clear(),this._audioSegmentInfoList=null,this._videoSegmentInfoList.clear(),this._videoSegmentInfoList=null,this._onInitSegment=null,this._onMediaSegment=null}},{key:"bindDataSource",value:function(e){return e.onDataAvailable=this.remux.bind(this),e.onTrackMetadata=this._onTrackMetadataReceived.bind(this),this}},{key:"insertDiscontinuity",value:function(){this._audioNextDts=this._videoNextDts=void 0}},{key:"seek",value:function(e){this._videoSegmentInfoList.clear(),this._audioSegmentInfoList.clear()}},{key:"remux",value:function(e,t){if(!this._onMediaSegment)throw new p.IllegalStateException("MP4Remuxer: onMediaSegment callback must be specificed!");this._dtsBaseInited||this._calculateDtsBase(e,t),this._remuxVideo(t),this._remuxAudio(e)}},{key:"_onTrackMetadataReceived",value:function(e,t){var i=null,n="mp4",r=t.codec;if("audio"===e)this._audioMeta=t,"mp3"===t.codec&&this._mp3UseMpegAudio?(n="mpeg",r="",i=new Uint8Array):i=l.default.generateInitSegment(t);else{if("video"!==e)return;this._videoMeta=t,i=l.default.generateInitSegment(t)}if(!this._onInitSegment)throw new p.IllegalStateException("MP4Remuxer: onInitSegment callback must be specified!");this._onInitSegment(e,{type:e,data:i.buffer,codec:r,container:e+"/"+n,mediaDuration:t.duration})}},{key:"_calculateDtsBase",value:function(e,t){this._dtsBaseInited||(e.samples&&e.samples.length&&(this._audioDtsBase=e.samples[0].dts),t.samples&&t.samples.length&&(this._videoDtsBase=t.samples[0].dts),this._dtsBase=Math.min(this._audioDtsBase,this._videoDtsBase),this._dtsBaseInited=!0)}},{key:"_remuxAudio",value:function(e){if(null!=this._audioMeta){var t=e,i=t.samples,n=void 0,r=-1,s=-1,a=this._audioMeta.refSampleDuration,u="mp3"===this._audioMeta.codec&&this._mp3UseMpegAudio,h=this._dtsBaseInited&&void 0===this._audioNextDts,c=!1;if(i&&0!==i.length){var p=0,m=null,v=0;u?(p=0,v=t.length):(p=8,v=8+t.length);var g=i[0].dts-this._dtsBase;if(this._audioNextDts)n=g-this._audioNextDts;else if(this._audioSegmentInfoList.isEmpty())n=0,this._fillSilentAfterSeek&&!this._videoSegmentInfoList.isEmpty()&&"mp3"!==this._audioMeta.originalCodec&&(c=!0);else{var y=this._audioSegmentInfoList.getLastSampleBefore(g);if(null!=y){var b=g-(y.originalDts+y.duration);b<=3&&(b=0);var E=y.dts+y.duration+b;n=g-E}else n=0}if(c){var S=g-n,k=this._videoSegmentInfoList.getLastSegmentBefore(g);if(null!=k&&k.beginDts<S){var w=d.default.getSilentFrame(this._audioMeta.originalCodec,this._audioMeta.channelCount);if(w){var L=k.beginDts,R=S-k.beginDts;o.default.v(this.TAG,"InsertPrefixSilentAudio: dts: "+L+", duration: "+R),i.unshift({unit:w,dts:L,pts:L}),v+=w.byteLength}}else c=!1}for(var A=[],O=0;O<i.length;O++){var x=i[O],T=x.unit,C=x.dts-this._dtsBase,B=C-n;this.lastAudioDts||(this.lastAudioDts=C),C-this.lastAudioDts>3e3&&this.meanAudioDuration>0&&(C=this.lastAudioDts+this.meanAudioDuration,B=C),this.lastAudioDts=C,-1===r&&(r=B);var D=0;if(this.meanAudioDuration||(this.meanAudioDuration=0),O!==i.length-1){D=i[O+1].dts-this._dtsBase-n-B}else D=A.length>=1?A[A.length-1].duration:Math.floor(a);D<1e3&&D>0?this.meanAudioDuration=(this.meanAudioDuration+D)/2:D=this.meanAudioDuration;var I=!1,M=null;if(D>1.5*a&&"mp3"!==this._audioMeta.codec&&this._fillAudioTimestampGap&&!f.default.safari){I=!0;var j=Math.abs(D-a),P=Math.ceil(j/a),U=B+a;o.default.w(this.TAG,"Large audio timestamp gap detected, may cause AV sync to drift. Silent frames will be generated to avoid unsync.\ndts: "+(B+D)+" ms, expected: "+(B+Math.round(a))+" ms, delta: "+Math.round(j)+" ms, generate: "+P+" frames");var N=d.default.getSilentFrame(this._audioMeta.originalCodec,this._audioMeta.channelCount);null==N&&(o.default.w(this.TAG,"Unable to generate silent frame for "+this._audioMeta.originalCodec+" with "+this._audioMeta.channelCount+" channels, repeat last frame"),N=T),M=[];for(var F=0;F<P;F++){var z=Math.round(U);if(M.length>0){var G=M[M.length-1];G.duration=z-G.dts}var V={dts:z,pts:z,cts:0,unit:N,size:N.byteLength,duration:0,originalDts:C,flags:{isLeading:0,dependsOn:1,isDependedOn:0,hasRedundancy:0}};M.push(V),v+=T.byteLength,U+=a}var H=M[M.length-1];H.duration=B+D-H.dts,D=Math.round(a)}A.push({dts:B,pts:B,cts:0,unit:x.unit,size:x.unit.byteLength,duration:D,originalDts:C,flags:{isLeading:0,dependsOn:1,isDependedOn:0,hasRedundancy:0}}),I&&A.push.apply(A,M)}u?m=new Uint8Array(v):(m=new Uint8Array(v),m[0]=v>>>24&255,m[1]=v>>>16&255,m[2]=v>>>8&255,m[3]=255&v,m.set(l.default.types.mdat,4));for(var q=0;q<A.length;q++){var K=A[q].unit;m.set(K,p),p+=K.byteLength}var W=A[A.length-1];s=W.dts+W.duration,this._audioNextDts=s;var X=new _.MediaSegmentInfo;X.beginDts=r,X.endDts=s,X.beginPts=r,X.endPts=s,X.originalBeginDts=A[0].originalDts,X.originalEndDts=W.originalDts+W.duration,X.firstSample=new _.SampleInfo(A[0].dts,A[0].pts,A[0].duration,A[0].originalDts,!1),X.lastSample=new _.SampleInfo(W.dts,W.pts,W.duration,W.originalDts,!1),this._isLive||this._audioSegmentInfoList.append(X),t.samples=A,t.sequenceNumber++;var Y=null;Y=u?new Uint8Array:l.default.moof(t,r),t.samples=[],t.length=0;var Z={type:"audio",data:this._mergeBoxes(Y,m).buffer,sampleCount:A.length,info:X};u&&h&&(Z.timestampOffset=r),this._onMediaSegment("audio",Z)}}}},{key:"_remuxVideo",value:function(e){if(null!=this._videoMeta){var t=e,i=t.samples,n=void 0,r=-1,s=-1,a=-1,o=-1;if(i&&0!==i.length){var u=8,h=8+e.length,d=new Uint8Array(h);d[0]=h>>>24&255,d[1]=h>>>16&255,d[2]=h>>>8&255,d[3]=255&h,d.set(l.default.types.mdat,4);var c=i[0].dts-this._dtsBase;if(this._videoNextDts)n=c-this._videoNextDts;else if(this._videoSegmentInfoList.isEmpty())n=0;else{var f=this._videoSegmentInfoList.getLastSampleBefore(c);if(null!=f){var p=c-(f.originalDts+f.duration);p<=3&&(p=0);var m=f.dts+f.duration+p;n=c-m}else n=0}for(var v=new _.MediaSegmentInfo,g=[],y=0;y<i.length;y++){this.meanVideoDuration||(this.meanVideoDuration=0);var b=i[y],E=b.dts-this._dtsBase,S=b.isKeyframe,k=E-n,w=b.cts,L=k+w;this.lastVideoDts||(this.lastVideoDts=E),E-this.lastVideoDts>3e3&&this.meanVideoDuration>0&&(E=this.lastVideoDts+this.meanVideoDuration,k=E,L=k+w),this.lastVideoDts=E,-1===r&&(r=k,a=L);var R=0;if(y!==i.length-1){R=i[y+1].dts-this._dtsBase-n-k}else R=g.length>=1?g[g.length-1].duration:Math.floor(this._videoMeta.refSampleDuration);if(R<1e3&&R>0?this.meanVideoDuration=(this.meanVideoDuration+R)/2:R=this.meanVideoDuration,S){var A=new _.SampleInfo(k,L,R,b.dts,!0);A.fileposition=b.fileposition,v.appendSyncPoint(A)}g.push({dts:k,pts:L,cts:w,units:b.units,size:b.length,isKeyframe:S,duration:R,originalDts:E,flags:{isLeading:0,dependsOn:S?2:1,isDependedOn:S?1:0,hasRedundancy:0,isNonSync:S?0:1}})}for(var O=0;O<g.length;O++)for(var x=g[O].units;x.length;){var T=x.shift(),C=T.data;d.set(C,u),u+=C.byteLength}var B=g[g.length-1];if(s=B.dts+B.duration,o=B.pts+B.duration,this._videoNextDts=s,v.beginDts=r,v.endDts=s,v.beginPts=a,v.endPts=o,v.originalBeginDts=g[0].originalDts,v.originalEndDts=B.originalDts+B.duration,v.firstSample=new _.SampleInfo(g[0].dts,g[0].pts,g[0].duration,g[0].originalDts,g[0].isKeyframe),v.lastSample=new _.SampleInfo(B.dts,B.pts,B.duration,B.originalDts,B.isKeyframe),this._isLive||this._videoSegmentInfoList.append(v),t.samples=g,t.sequenceNumber++,this._forceFirstIDR){var D=g[0].flags;D.dependsOn=2,D.isNonSync=0}var I=l.default.moof(t,r);t.samples=[],t.length=0,this._onMediaSegment("video",{type:"video",data:this._mergeBoxes(I,d).buffer,sampleCount:g.length,info:v})}}}},{key:"_mergeBoxes",value:function(e,t){var i=new Uint8Array(e.byteLength+t.byteLength);return i.set(e,0),i.set(t,e.byteLength),i}},{key:"onInitSegment",get:function(){return this._onInitSegment},set:function(e){this._onInitSegment=e}},{key:"onMediaSegment",get:function(){return this._onMediaSegment},set:function(e){this._onMediaSegment=e}}]),e}();i.default=m},{"../core/media-segment-info.js":8,"../utils/browser.js":40,"../utils/exception.js":41,"../utils/logger.js":42,"./aac-silent.js":37,"./mp4-generator.js":38}],40:[function(e,t,i){"use strict";Object.defineProperty(i,"__esModule",{value:!0});var n={};!function(){var e=self.navigator.userAgent.toLowerCase(),t=/(edge)\/([\w.]+)/.exec(e)||/(opr)[\/]([\w.]+)/.exec(e)||/(chrome)[ \/]([\w.]+)/.exec(e)||/(iemobile)[\/]([\w.]+)/.exec(e)||/(version)(applewebkit)[ \/]([\w.]+).*(safari)[ \/]([\w.]+)/.exec(e)||/(webkit)[ \/]([\w.]+).*(version)[ \/]([\w.]+).*(safari)[ \/]([\w.]+)/.exec(e)||/(webkit)[ \/]([\w.]+)/.exec(e)||/(opera)(?:.*version|)[ \/]([\w.]+)/.exec(e)||/(msie) ([\w.]+)/.exec(e)||e.indexOf("trident")>=0&&/(rv)(?::| )([\w.]+)/.exec(e)||e.indexOf("compatible")<0&&/(firefox)[ \/]([\w.]+)/.exec(e)||[],i=/(ipad)/.exec(e)||/(ipod)/.exec(e)||/(windows phone)/.exec(e)||/(iphone)/.exec(e)||/(kindle)/.exec(e)||/(android)/.exec(e)||/(windows)/.exec(e)||/(mac)/.exec(e)||/(linux)/.exec(e)||/(cros)/.exec(e)||[],r={browser:t[5]||t[3]||t[1]||"",version:t[2]||t[4]||"0",majorVersion:t[4]||t[2]||"0",platform:i[0]||""},s={};if(r.browser){s[r.browser]=!0;var a=r.majorVersion.split(".");s.version={major:parseInt(r.majorVersion,10),string:r.version},a.length>1&&(s.version.minor=parseInt(a[1],10)),a.length>2&&(s.version.build=parseInt(a[2],10))}r.platform&&(s[r.platform]=!0),(s.chrome||s.opr||s.safari)&&(s.webkit=!0),(s.rv||s.iemobile)&&(s.rv&&delete s.rv,r.browser="msie",s.msie=!0),s.edge&&(delete s.edge,r.browser="msedge",s.msedge=!0),s.opr&&(r.browser="opera",s.opera=!0),s.safari&&s.android&&(r.browser="android",s.android=!0),s.name=r.browser,s.platform=r.platform;for(var o in n)n.hasOwnProperty(o)&&delete n[o];Object.assign(n,s)}(),i.default=n},{}],41:[function(e,t,i){"use strict";function n(e,t){if(!e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return!t||"object"!=typeof t&&"function"!=typeof t?e:t}function r(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function, not "+typeof t);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}}),t&&(Object.setPrototypeOf?Object.setPrototypeOf(e,t):e.__proto__=t)}function s(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var a=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),o=i.RuntimeException=function(){function e(t){s(this,e),this._message=t}return a(e,[{key:"toString",value:function(){return this.name+": "+this.message}},{key:"name",get:function(){return"RuntimeException"}},{key:"message",get:function(){return this._message}}]),e}();i.IllegalStateException=function(e){function t(e){return s(this,t),n(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,e))}return r(t,e),a(t,[{key:"name",get:function(){return"IllegalStateException"}}]),t}(o),i.InvalidArgumentException=function(e){function t(e){return s(this,t),n(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,e))}return r(t,e),a(t,[{key:"name",get:function(){return"InvalidArgumentException"}}]),t}(o),i.NotImplementedException=function(e){function t(e){return s(this,t),n(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,e))}return r(t,e),a(t,[{key:"name",get:function(){return"NotImplementedException"}}]),t}(o)},{}],42:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var r=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),s=e("events"),a=function(e){return e&&e.__esModule?e:{default:e}}(s),o=function(){function e(){n(this,e)}return r(e,null,[{key:"e",value:function(t,i){t&&!e.FORCE_GLOBAL_TAG||(t=e.GLOBAL_TAG);var n="["+t+"] > "+i;e.ENABLE_CALLBACK&&e.emitter.emit("log","error",n),e.ENABLE_ERROR&&(console.error?console.error(n):console.warn?console.warn(n):console.log(n))}},{key:"i",value:function(t,i){t&&!e.FORCE_GLOBAL_TAG||(t=e.GLOBAL_TAG);var n="["+t+"] > "+i;e.ENABLE_CALLBACK&&e.emitter.emit("log","info",n),e.ENABLE_INFO&&(console.info?console.info(n):console.log(n))}},{key:"w",value:function(t,i){t&&!e.FORCE_GLOBAL_TAG||(t=e.GLOBAL_TAG);var n="["+t+"] > "+i;e.ENABLE_CALLBACK&&e.emitter.emit("log","warn",n),e.ENABLE_WARN&&(console.warn?console.warn(n):console.log(n))}},{key:"d",value:function(t,i){t&&!e.FORCE_GLOBAL_TAG||(t=e.GLOBAL_TAG);var n="["+t+"] > "+i;e.ENABLE_CALLBACK&&e.emitter.emit("log","debug",n),e.ENABLE_DEBUG&&(console.debug?console.debug(n):console.log(n))}},{key:"v",value:function(t,i){t&&!e.FORCE_GLOBAL_TAG||(t=e.GLOBAL_TAG);var n="["+t+"] > "+i;e.ENABLE_CALLBACK&&e.emitter.emit("log","verbose",n),e.ENABLE_VERBOSE&&console.log(n)}}]),e}();o.GLOBAL_TAG="flv.js",o.FORCE_GLOBAL_TAG=!1,o.ENABLE_ERROR=!0,o.ENABLE_INFO=!0,o.ENABLE_WARN=!0,o.ENABLE_DEBUG=!0,o.ENABLE_VERBOSE=!0,o.ENABLE_CALLBACK=!1,o.emitter=new a.default,i.default=o},{events:2}],43:[function(e,t,i){"use strict";function n(e){return e&&e.__esModule?e:{default:e}}function r(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var s=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),a=e("events"),o=n(a),u=e("./logger.js"),l=n(u),h=function(){function e(){r(this,e)}return s(e,null,[{key:"getConfig",value:function(){return{globalTag:l.default.GLOBAL_TAG,forceGlobalTag:l.default.FORCE_GLOBAL_TAG,enableVerbose:l.default.ENABLE_VERBOSE,enableDebug:l.default.ENABLE_DEBUG,enableInfo:l.default.ENABLE_INFO,enableWarn:l.default.ENABLE_WARN,enableError:l.default.ENABLE_ERROR,enableCallback:l.default.ENABLE_CALLBACK}}},{key:"applyConfig",value:function(e){l.default.GLOBAL_TAG=e.globalTag,l.default.FORCE_GLOBAL_TAG=e.forceGlobalTag,l.default.ENABLE_VERBOSE=e.enableVerbose,l.default.ENABLE_DEBUG=e.enableDebug,l.default.ENABLE_INFO=e.enableInfo,l.default.ENABLE_WARN=e.enableWarn,l.default.ENABLE_ERROR=e.enableError,l.default.ENABLE_CALLBACK=e.enableCallback}},{key:"_notifyChange",value:function(){var t=e.emitter;if(t.listenerCount("change")>0){var i=e.getConfig();t.emit("change",i)}}},{key:"registerListener",value:function(t){e.emitter.addListener("change",t)}},{key:"removeListener",value:function(t){e.emitter.removeListener("change",t)}},{key:"addLogListener",value:function(t){l.default.emitter.addListener("log",t),l.default.emitter.listenerCount("log")>0&&(l.default.ENABLE_CALLBACK=!0,e._notifyChange())}},{key:"removeLogListener",value:function(t){l.default.emitter.removeListener("log",t),0===l.default.emitter.listenerCount("log")&&(l.default.ENABLE_CALLBACK=!1,e._notifyChange())}},{key:"forceGlobalTag",get:function(){return l.default.FORCE_GLOBAL_TAG},set:function(t){l.default.FORCE_GLOBAL_TAG=t,e._notifyChange()}},{key:"globalTag",get:function(){return l.default.GLOBAL_TAG},set:function(t){l.default.GLOBAL_TAG=t,e._notifyChange()}},{key:"enableAll",get:function(){return l.default.ENABLE_VERBOSE&&l.default.ENABLE_DEBUG&&l.default.ENABLE_INFO&&l.default.ENABLE_WARN&&l.default.ENABLE_ERROR},set:function(t){l.default.ENABLE_VERBOSE=t,l.default.ENABLE_DEBUG=t,l.default.ENABLE_INFO=t,l.default.ENABLE_WARN=t,l.default.ENABLE_ERROR=t,e._notifyChange()}},{key:"enableDebug",get:function(){return l.default.ENABLE_DEBUG},set:function(t){l.default.ENABLE_DEBUG=t,e._notifyChange()}},{key:"enableVerbose",get:function(){return l.default.ENABLE_VERBOSE},set:function(t){l.default.ENABLE_VERBOSE=t,e._notifyChange()}},{key:"enableInfo",get:function(){return l.default.ENABLE_INFO},set:function(t){l.default.ENABLE_INFO=t,e._notifyChange()}},{key:"enableWarn",get:function(){return l.default.ENABLE_WARN},set:function(t){l.default.ENABLE_WARN=t,e._notifyChange()}},{key:"enableError",get:function(){return l.default.ENABLE_ERROR},set:function(t){l.default.ENABLE_ERROR=t,e._notifyChange()}}]),e}();h.emitter=new o.default,i.default=h},{"./logger.js":42,events:2}],44:[function(e,t,i){"use strict";function n(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(i,"__esModule",{value:!0});var r=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),s=function(){function t(){n(this,t)}return r(t,null,[{key:"install",value:function(){Object.setPrototypeOf=Object.setPrototypeOf||function(e,t){return e.__proto__=t,e},Object.assign=Object.assign||function(e){if(void 0===e||null===e)throw new TypeError("Cannot convert undefined or null to object");for(var t=Object(e),i=1;i<arguments.length;i++){var n=arguments[i];if(void 0!==n&&null!==n)for(var r in n)n.hasOwnProperty(r)&&(t[r]=n[r])}return t},"function"!=typeof self.Promise&&e("es6-promise").polyfill()}}]),t}();s.install(),i.default=s},{"es6-promise":1}],45:[function(e,t,i){"use strict";function n(e,t,i){var n=e;if(t+i<n.length){for(;i--;)if(128!=(192&n[++t]))return!1;return!0}return!1}function r(e){for(var t=[],i=e,r=0,s=e.length;r<s;)if(i[r]<128)t.push(String.fromCharCode(i[r])),++r;else{if(i[r]<192);else if(i[r]<224){if(n(i,r,1)){var a=(31&i[r])<<6|63&i[r+1];if(a>=128){t.push(String.fromCharCode(65535&a)),r+=2;continue}}}else if(i[r]<240){if(n(i,r,2)){var o=(15&i[r])<<12|(63&i[r+1])<<6|63&i[r+2];if(o>=2048&&55296!=(63488&o)){t.push(String.fromCharCode(65535&o)),r+=3;continue}}}else if(i[r]<248&&n(i,r,3)){var u=(7&i[r])<<18|(63&i[r+1])<<12|(63&i[r+2])<<6|63&i[r+3];if(u>65536&&u<1114112){u-=65536,t.push(String.fromCharCode(u>>>10|55296)),t.push(String.fromCharCode(1023&u|56320)),r+=4;continue}}t.push(String.fromCharCode(65533)),++r}return t.join("")}Object.defineProperty(i,"__esModule",{value:!0}),i.default=r},{}]},{},[22])(22)});
/*
*@author liuguifng
*@date 2018.02.06
*@package  
*@access public
*
*/

class Logger {

    constructor(name, writedb, maxcount) {
        this._name = name ? name : 'ZLLogger';
        this._maxcount = maxcount ? maxcount : 1024 * 1024;
        if (writedb) {
            let result = indexedDB.open(this._name, 1);
            result.onerror = function (event) {
                console.error('ZLLogger open db error');
            };
            result.onsuccess = function (event) {
                // Do something with request.result!
                this._dataBase = event.target.result;
                this._isValid = true;
            }.bind(this);
            result.onupgradeneeded = function (e) { 
                let db = e.target.result;
                if (!db.objectStoreNames.contains(this._name)) { 
                    let store = db.createObjectStore(this._name); 
                    store.createIndex('name', 'name');
                    store.createIndex('tag', 'tag');
                    store.createIndex('level', 'level');
                    store.createIndex('time', 'time');
                    store.createIndex('info', 'info');
                } 
            }.bind(this);
        }
        else {
            this._isValid = true;
        }
    }

    write(tag, level, info, showconsole) {
        
        if (!this._isValid) {
            console.warn('invalid ZLLogger');
            return;
        }

        let timeNow = new Date();

        if (this._dataBase) {
            let objectStore = this._dataBase.transaction(this._name, 'readwrite').objectStore(this._name);

            if (objectStore) {
                let countRequest = objectStore.count();
                countRequest.onsuccess = function () {
                    if (countRequest.result >= this._maxcount) {
                        let keyRangeValue = IDBKeyRange.upperBound((new Date().getTime()));
                        let nRemovedCount = 0;
                        objectStore.openCursor(keyRangeValue).onsuccess = function (event) {
                            let cursor = event.target.result;
                            if (cursor) {
                                objectStore.delete(cursor.key);
                                nRemovedCount++;
                                if (nRemovedCount < 100) {
                                    cursor.continue();
                                }
                            }
                        };
                    }
                }.bind(this);
                
                objectStore.put({name: this._name, tag: tag, level: level, time: timeNow.toString(), info: info}, timeNow.getTime());
            }
        }
        if (showconsole) {
            let logfunc = console.log;
            if (level === 'warn') { 
                logfunc = console.warn;
            }
            else if (level === 'error') {
                logfunc = console.error;
            }
            logfunc(`[${this._name}][${tag}][${level}][${timeNow.toString()}]  ${info}`);
        }
    }
    
    query(timebegin, timeend) {

        if (!this._isValid) {
            console.warn('invalid ZLLogger');
            return;
        }   
        let keyRangeValue = IDBKeyRange.bound(timebegin, timeend, true, true);
        let objectStore = this._dataBase.transaction(this._name).objectStore(this._name);
        objectStore.openCursor(keyRangeValue).onsuccess = function (event) {
            let cursor = event.target.result;
            if (cursor) {
                console.log(JSON.stringify(cursor.value));
                cursor.continue();
            }
        };
    }

    clear() {
        console.warn('clear log');

        if (this._dataBase) {
            let store = this._dataBase.transaction(this._name, 'readwrite').objectStore(this._name);
            store.clear();
        }  
    }
}

/*
 * Copyright (C) 2016 Bilibili. All Rights Reserved.
 *
 * @author zheng qian <xqq@xqq.im>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

let Browser = {};

function detect() {
    // modified from jquery-browser-plugin

    let ua = self.navigator.userAgent.toLowerCase();

    let match = /(edge)\/([\w.]+)/.exec(ua) ||
        /(opr)[\/]([\w.]+)/.exec(ua) ||
        /(chrome)[ \/]([\w.]+)/.exec(ua) ||
        /(iemobile)[\/]([\w.]+)/.exec(ua) ||
        /(version)(applewebkit)[ \/]([\w.]+).*(safari)[ \/]([\w.]+)/.exec(ua) ||
        /(webkit)[ \/]([\w.]+).*(version)[ \/]([\w.]+).*(safari)[ \/]([\w.]+)/.exec(ua) ||
        /(webkit)[ \/]([\w.]+)/.exec(ua) ||
        /(opera)(?:.*version|)[ \/]([\w.]+)/.exec(ua) ||
        /(msie) ([\w.]+)/.exec(ua) ||
        ua.indexOf('trident') >= 0 && /(rv)(?::| )([\w.]+)/.exec(ua) ||
        ua.indexOf('compatible') < 0 && /(firefox)[ \/]([\w.]+)/.exec(ua) ||
        [];

    let platform_match = /(ipad)/.exec(ua) ||
        /(ipod)/.exec(ua) ||
        /(windows phone)/.exec(ua) ||
        /(iphone)/.exec(ua) ||
        /(kindle)/.exec(ua) ||
        /(android)/.exec(ua) ||
        /(windows)/.exec(ua) ||
        /(mac)/.exec(ua) ||
        /(linux)/.exec(ua) ||
        /(cros)/.exec(ua) ||
        [];

    let matched = {
        browser: match[5] || match[3] || match[1] || '',
        version: match[2] || match[4] || '0',
        majorVersion: match[4] || match[2] || '0',
        platform: platform_match[0] || ''
    };

    let browser = {};
    if (matched.browser) {
        browser[matched.browser] = true;

        let versionArray = matched.majorVersion.split('.');
        browser.version = {
            major: parseInt(matched.majorVersion, 10),
            string: matched.version
        };
        if (versionArray.length > 1) {
            browser.version.minor = parseInt(versionArray[1], 10);
        }
        if (versionArray.length > 2) {
            browser.version.build = parseInt(versionArray[2], 10);
        }
    }

    if (matched.platform) {
        browser[matched.platform] = true;
    }

    if (browser.chrome || browser.opr || browser.safari) {
        browser.webkit = true;
    }

    // MSIE. IE11 has 'rv' identifer
    if (browser.rv || browser.iemobile) {
        if (browser.rv) {
            delete browser.rv;
        }
        let msie = 'msie';
        matched.browser = msie;
        browser[msie] = true;
    }

    // Microsoft Edge
    if (browser.edge) {
        delete browser.edge;
        let msedge = 'msedge';
        matched.browser = msedge;
        browser[msedge] = true;
    }

    // Opera 15+
    if (browser.opr) {
        let opera = 'opera';
        matched.browser = opera;
        browser[opera] = true;
    }

    // Stock android browsers are marked as Safari
    if (browser.safari && browser.android) {
        let android = 'android';
        matched.browser = android;
        browser[android] = true;
    }

    browser.name = matched.browser;
    browser.platform = matched.platform;

    for (let key in Browser) {
        if (Browser.hasOwnProperty(key)) {
            delete Browser[key];
        }
    }
    Object.assign(Browser, browser);
}

detect();

//export default Browser;


/*
*@author liuguifng
*@date 2017.08.15
*@package  
*@access public
*
*/


function setCss3(obj, attrObj) {
    for (let i in attrObj) {
        let newi = i;
        if (newi.indexOf('-') > 0) {
            let num = newi.indexOf('-'); 
            newi = newi.replace(newi.substr(num, 2), newi.substr(num + 1, 1).toUpperCase());
        }
        obj.style[newi] = attrObj[i];
        newi = newi.replace(newi.charAt(0), newi.charAt(0).toUpperCase());
        obj.style['webkit' + newi] = attrObj[i];
        obj.style['moz' + newi] = attrObj[i];
        obj.style['o' + newi] = attrObj[i];
        obj.style['ms' + newi] = attrObj[i];
    }
}

function controlbar(videoElement, shownTime) {
    this.videoElement = videoElement;
    this.shownTime = shownTime;
    this.totolTime = 0;
    this.currentTime = 0;
    this.buffTime = 0;
    this.speed = 1.0;

    //控制条框架
    this.frameDiv = document.createElement('div');
    this.frameDiv.style.top = this.videoElement.offsetHeight;
    this.frameDiv.style.left = this.videoElement.left;
    this.frameDiv.style.backgroundColor = 'rgba(100, 100, 100, 0.5)';
    this.frameDiv.style.zIndex = 200;
    this.frameDiv.style.width = this.videoElement.offsetWidth;
    this.frameDiv.style.height = '30px';
    this.frameDiv.style.position = 'absolute';
    this.frameDiv.style.float = 'left';

    //控制条播放/暂停按钮
    this.btnPlay = document.createElement('img');
    this.btnPlay.style.width = this.frameDiv.style.height;
    this.btnPlay.style.height = this.frameDiv.style.height;
    this.btnPlay.style.float = 'left';
    this.btnPlay.src = zlplayer.resPath + 'res/play.png';

    this.btnPlay.onclick = function () {
        videoElement.paused ? videoElement.play() : videoElement.pause();
    };

    this.frameDiv.appendChild(this.btnPlay);

    //控制条进度框架
    this.progressBoxDiv = document.createElement('div');
    this.progressBoxDiv.style.width = (parseInt(this.frameDiv.style.width) - 2 * parseInt(this.btnPlay.style.height) - 70) + 'px';
    this.progressBoxDiv.style.height = this.frameDiv.style.height;
    this.progressBoxDiv.style.float = 'left';
    this.progressBoxDiv.style.display =  'inline-block';
    this.progressBoxDiv.style.verticalAlign =  'center';
    this.frameDiv.appendChild(this.progressBoxDiv);

    //控制条播放进度
    this.progressPlayDiv = document.createElement('div');
    this.progressPlayDiv.style.width = '0px';
    this.progressPlayDiv.style.height = this.progressBoxDiv.style.height;
    this.progressPlayDiv.style.backgroundColor = 'rgba(10, 10, 10, 0.8)';
    this.progressPlayDiv.style.float = 'left';
    this.progressBoxDiv.appendChild(this.progressPlayDiv);
    
    //进度条拖拽按钮
    this.progressHandle = document.createElement('div');
    this.progressHandle.style.width = '8px';
    this.progressHandle.style.height = this.progressBoxDiv.style.height;
    this.progressHandle.style.backgroundColor = 'rgba(10, 10, 10, 1)';
    this.progressHandle.style.float = 'left';
    this.progressBoxDiv.appendChild(this.progressHandle);

    //进度条缓冲进度
    this.progressBufDiv = document.createElement('div');
    this.progressBufDiv.style.width = '0px';
    this.progressBufDiv.style.height = this.progressBoxDiv.style.height;
    this.progressBufDiv.style.backgroundColor = 'rgba(155, 155, 155, 0.8)';
    this.progressBufDiv.style.float = 'left';
    this.progressBoxDiv.appendChild(this.progressBufDiv);

    //时间
    this.timeText = document.createElement('span');
    this.timeText.innerText = '00:00/00:00';
    this.timeText.style.height = this.frameDiv.style.height;
    this.timeText.style.width = '90px';
    this.timeText.style.float = 'left';
    this.timeText.style.color = 'rgb(255,255,255)';
    this.timeText.style.display = 'inline-block';
    this.timeText.style.textAlign = 'center';
    this.timeText.style.lineHeight = this.timeText.style.height;

    this.frameDiv.appendChild(this.timeText);

    /*
    //速度
    this.speedText = document.createElement('sapn');
    this.speedText.innerText = 'x1.0';
    this.speedText.style.height = this.frameDiv.style.height;
    this.speedText.style.width = '30px';
    this.speedText.style.backgroundColor = 'rgba(100, 100, 100, 0)';
    this.speedText.style.color = 'rgb(100,100,100)';
    this.speedText.style.float = 'left';
    this.speedText.style.display = 'inline-block';
    this.speedText.style.textAlign = 'center';
    this.speedText.style.lineHeight = this.timeText.style.height;
    this.frameDiv.appendChild(this.speedText);
    */

     //音频按钮
    this.btnSound = document.createElement('img');
    this.btnSound.style.height = this.frameDiv.style.height;
    this.btnSound.style.width = this.frameDiv.style.height;
    this.btnSound.style.float = 'right';
    this.btnSound.src = zlplayer.resPath + 'res/sound.png';
 
    this.btnSound.onclick = function () {
        if (videoElement.muted) {
            videoElement.muted = false;
            if (!videoElement.muted) {
                this.btnSound.src = zlplayer.resPath + 'res/sound.png';
            }
        }
        else {
            videoElement.muted = true;
            this.btnSound.src = zlplayer.resPath + 'res/mute.png';
        }
    }.bind(this); 
     
    videoElement.addEventListener('canplay', function () {
        if (videoElement.muted) {
            this.btnSound.src = zlplayer.resPath + 'res/mute.png';
        }
        else {
            this.btnSound.src = zlplayer.resPath + 'res/sound.png';
        }
        this.resize();
    }.bind(this));

    //全屏按钮
    this.btnFullScreen = document.createElement('img');
    this.btnFullScreen.style.height = this.frameDiv.style.height;
    this.btnFullScreen.style.width = this.frameDiv.style.height;
    this.btnFullScreen.style.float = 'right';
    this.btnFullScreen.src = zlplayer.resPath + 'res/fullscreen.png';

    this.btnFullScreen.onclick = function () {
        let e = document.createEvent('MouseEvent');
        e.initEvent('dblclick', false, false);
        videoElement.dispatchEvent(e); 
    };

    this.frameDiv.appendChild(this.btnFullScreen);
    this.frameDiv.appendChild(this.btnSound);

    window.addEventListener('resize', function () {
        this.resize();
    }.bind(this));

    videoElement.addEventListener('loadedmetadata', function () {
        let duration = videoElement.duration;
        this.updateTime(0, 0, duration);
    }.bind(this));

    videoElement.addEventListener('play', function () {
        this.btnPlay.src = zlplayer.resPath + 'res/pause.png';
    }.bind(this));

    videoElement.addEventListener('pause', function () {
        this.btnPlay.src = zlplayer.resPath + 'res/play.png';
    }.bind(this));

    videoElement.addEventListener('ended', function () {
        this.btnPlay.src = zlplayer.resPath + 'res/play.png';
    }.bind(this));

    videoElement.addEventListener('timeupdate', function () {
        let currentTime = videoElement.currentTime;
        let duration = videoElement.duration;
        if (videoElement.buffered.length > 0) {
            let bufferd = videoElement.buffered.end(0);
            this.updateTime(currentTime, bufferd, duration);
        }

        if (currentTime > 1.0 && currentTime < 2.0) {
            this.resize();
        }
    }.bind(this));

    let timerShown = null;
    videoElement.addEventListener('mouseleave', function (ev) {
        timerShown = setTimeout(function () {
            if (this.frameDiv.style.display != 'none') {
                this.frameDiv.style.display = 'none';
            }
        }.bind(this), this.shownTime);
    }.bind(this));

    videoElement.addEventListener('mousemove', function (ev) {
        if (this.frameDiv.style.display == 'none') {
            this.frameDiv.style.display = '';
        }
        if (timerShown) {
            clearTimeout(timerShown);
            timerShown = null;
        }
    }.bind(this));

    document.addEventListener('fullscreenchange', function () { 
        setTimeout(() => {
            videoElement.controls = document.fullScreen;
            this.resize();
        }, 300);
    }.bind(this));

    document.addEventListener('webkitfullscreenchange', function () { 
        setTimeout(() => {
            videoElement.controls = document.fullScreen;
            this.resize();
        }, 300);
    }.bind(this));
    document.addEventListener('mozfullscreenchange', function () { 
        setTimeout(() => {
            videoElement.controls = document.fullScreen;
            this.resize();
        }, 300);
    }.bind(this));

    this.frameDiv.onmousemove = function () {
        if (timerShown) {
            clearTimeout(timerShown);
            timerShown = null;
        }
    };

    this.frameDiv.onmouseleave = function () {
        if (!timerShown) {
            timerShown = setTimeout(function () {
                if (this.frameDiv.style.display != 'none') {
                    this.frameDiv.style.display = 'none';
                }
            }.bind(this), this.shownTime);
        }
    }.bind(this);

    let handle = this.progressHandle;
    let box = this.progressBoxDiv;
    let controler = this;
    let drag = false;
    let buffBar = this.progressBufDiv;
    let playProgress = this.progressPlayDiv;
    let textSpan = this.timeText;

    function getPoint(obj) { 
        let t = obj.offsetTop; 
        let l = obj.offsetLeft; 
        //判断是否有父容器，如果存在则累加其边距
        while ((obj = obj.offsetParent)) {
            t += obj.offsetTop; 
            l += obj.offsetLeft; 
        }
        return {top: t, left: l};
    }
    box.onmousedown = function (ev) {
        let evPtX = ev.pageX - getPoint(box).left;
        if ((evPtX > handle.offsetLeft && evPtX < buffBar.offsetLeft) || videoElement.paused) {
            return;
        }
        if (evPtX >= (buffBar.offsetLeft + parseInt(buffBar.style.width))) {
            return;
        }
        let duration = videoElement.duration;
        if (isNaN(duration) || duration == Infinity) {
            return;
        }
        let currentTime = parseInt(evPtX / (textSpan.offsetLeft - box.offsetLeft) *  duration);
        videoElement.currentTime = currentTime;
    };
    
    /*
    handle.onmousedown = function(ev) {
        if (videoElement.paused) {
            return;
        }
        videoElement.pause();
        drag = true;
        box.onmousemove = function(event) {
                let evPtX = event.layerX - box.offsetLeft;
                let duration = videoElement.duration;
                let currentTime = parseInt(evPtX/(textSpan.offsetLeft - box.offsetLeft) *  duration );
                let bufferd = videoElement.buffered.end(0);
                controler.updateTime(currentTime, bufferd, duration);
        };
        box.onmouseup = function(event) {
            box.onmousemove = null;
            box.onmouseup = null;
            drag = false;
            videoElement.play();
            let duration = videoElement.duration;
            let evPtX = event.layerX - box.offsetLeft;
            let currentTime = parseInt(evPtX/(textSpan.offsetLeft - box.offsetLeft) *  duration );
            videoElement.currentTime = currentTime;
        };
        box.onmouseleave = function() {
            if (drag) {
                box.onmousemove = null;
            box.onmouseup = null;
                drag = false;
                videoElement.play();
                videoElement.currentTime = controler.currentTime;
            }
        }; 
    };
    */
    this.show();
}

controlbar.prototype.updateTime = function (currentTime, buffTime, totalTime) {
    if (totalTime < 0 || isNaN(totalTime) || totalTime == Infinity) {
        totalTime = currentTime;
        buffTime = 0;
    }

    this.currentTime = currentTime;
    this.buffTime = buffTime;
    this.totalTime = totalTime;
    
    this.timeText.innerText = parseInt(currentTime / 60) + ':' + parseInt(currentTime % 60) + '/' + parseInt(totalTime / 60) + ':' + parseInt(totalTime % 60);
    this.progressPlayDiv.style.width = parseInt((this.progressBoxDiv.offsetWidth - this.progressHandle.offsetWidth) * currentTime / totalTime)  + 'px';
    this.progressBufDiv.style.width = buffTime - currentTime > 0 ? parseInt((this.progressBoxDiv.offsetWidth - this.progressHandle.offsetWidth) * (buffTime - currentTime) / totalTime)  + 'px' : '0px';
};

controlbar.prototype.resize = function () {
    let isVertical = this.videoElement.rotate == 90 || this.videoElement.rotate == 270;
    this.frameDiv.style.width =  (isVertical ? this.videoElement.offsetHeight : this.videoElement.offsetWidth) + 'px';
    this.frameDiv.style.top = (isVertical ? this.videoElement.offsetLeft + this.videoElement.offsetWidth - 30 : this.videoElement.offsetTop + this.videoElement.offsetHeight - 30) + 'px';
    this.frameDiv.style.left = this.videoElement.offsetLeft + 'px';
    this.progressBoxDiv.style.width = (parseInt(this.frameDiv.style.width) - 2 * parseInt(this.btnPlay.style.height) - 130) + 'px';
};

controlbar.prototype.show = function () {
    if (this.videoElement.parentNode) {
        this.videoElement.parentNode.appendChild(this.frameDiv);
        this.resize();
    }
};

controlbar.prototype.hide = function () {
    if (this.videoElement.parentNode && this.frameDiv.parentNode == this.videoElement.parentNode) {
        this.videoElement.parentNode.removeChild(this.frameDiv);
        this.resize();
    }
};

let zlplayer = function (videoElement, config) {
    
    flvjs.LoggingControl.enableAll = false;
    flvjs.LoggingControl.enableError = true;

    this.isFullScreen = false;

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'none';

    //TODU: check video and config valid
    if (!config.username || !config.password || config.username.length == 0) {
        config.username = 'admin';
        config.password = '123456';
    }
    //in url, parse username and password in url
    let posStart = config.url.indexOf('//') + 2;
    let posEnd = config.url.indexOf('@');
    if (posEnd >= 0) {
        let usrInfo = config.url.substring(posStart, posEnd);
        let posSplit = usrInfo.indexOf(':');
        if (posSplit > 0) { 
            //no userinfo in config use parsed info
            if (config.username.length == 0 && config.password.length == 0) {
                config.username = usrInfo.substring(0, posSplit);
                config.password = usrInfo.substring(posSplit + 1);
            }
            config.url = config.url.substring(0, posStart) + config.url.substring(posEnd + 1);
        }
    } 
    
    this.flvSrc = {
        type: typeof(config.type) == 'undefined' ? 'flv' : config.type,
        isLive: config.isLive,
        hasAudio: typeof(config.hasAudio) == 'undefined'  ? !config.isLive : config.hasAudio,
        url: config.url,
        fixAudioTimestampGap: false
    };

    this.enableFullScreen = config.enableFullScreen;
    this.enableFillWindow = config.enableFillWindow;
    this.maxRelexRgnPtCount = config.relexRgnPtCount;
    this.useCustomFullScreen = config.useCustomFullScreen;

    let liveConfig = {
        enableWorker: true,
        enableStashBuffer: true,
        stashInitialSize: 256,
        lazyLoad: false,

        autoCleanupSourceBuffer: true,
        autoCleanupMinBackwardDuration: 1.5,
        autoCleanupMaxBackwardDuration: 2.2,
        username: config.username,
        password: config.password,
        server: config.server
    };

    let playbackConfig = {
        enableWorker: true,
        lazyLoad: true,
        enableStashBuffer: true,
        autoCleanupSourceBuffer: false,
        autoCleanupMinBackwardDuration: 5,
        autoCleanupMaxBackwardDuration: 10,
        username: config.username,
        password: config.password,
        seekType: 'param',
        date: config.date,
        auth: config.auth,
        server: config.server
    };

    let streamConfig = null;
    if (config.isLive) {
        streamConfig = liveConfig;
    } else {
        streamConfig = playbackConfig;
    }

    this.streamConfig = streamConfig;
    this.videoElement = videoElement;

    if (videoElement.parentNode) {
        if (videoElement.parentNode.style.width == 'auto') {
            videoElement.parentNode.style.width = '576px';
            videoElement.widthX = 95;
        }
        if (videoElement.parentNode.style.height == 'auto') {
            videoElement.parentNode.style.height = '704px';
            videoElement.heightX = 95;
        }
    }

    if (videoElement.style.width == '' && !videoElement.widthX) {
        videoElement.style.width = '100%';
    }
    if (videoElement.style.height == '' && !videoElement.heightX) {
        videoElement.style.height = '100%';
    }
    
    if ((videoElement.style.width.indexOf('%') > 0 || videoElement.style.height.indexOf('%') >= 0) && (!videoElement.widthX || !videoElement.heightX)) {
        if (videoElement.style.width.indexOf('%') >= 0) {
            videoElement.widthX = parseInt(videoElement.style.width);
            if (config.rotate && videoElement.rotate == 90 || videoElement.rotate == 270) {
                videoElement.style.width = videoElement.parentNode.offsetWidth * videoElement.widthX / 100.0 + 'px';
            }
        }
        if (videoElement.style.height.indexOf('%') >= 0) {
            videoElement.heightX = parseInt(videoElement.style.height);
            if (config.rotate && videoElement.rotate == 90 || videoElement.rotate == 270) {
                videoElement.style.height = videoElement.parentNode.offsetHeight * videoElement.heightX / 100.0 + 'px';
            }
        }
    }
    
    this.videoElement.controls = false;
    this.videoElement.muted = true;

    if (config.enableFilter && config.filter) {
        this.filter = config.filter; 
        if (this.videoElement.parentNode) {
            this.videoElement.parentNode.appendChild(this.canvas);
        }
        this.canvas.width = this.videoElement.offsetWidth;
        this.canvas.height = this.videoElement.offsetHeight;
        this.canvas.style.zIndex = 100;
        this.canvas.style.display = '';
        this.canvas.style.position = 'absolute';
        this.canvas.style.left = `${this.videoElement.offsetLeft}px`;
        this.canvas.style.top = `${this.videoElement.offsetTop}px`;
        
        this.canvas.addEventListener('mousemove', function (event) {
            let eventMove = document.createEvent('MouseEvent');  
            eventMove.initMouseEvent('mousemove', true, true, window, 0,  
            event.screenX, event.screenY, event.clientX, event.clientY, false, false, false, false, 0, null);  
            videoElement.dispatchEvent(eventMove);
        });
    
        this.canvas.addEventListener('mouseleave', function (event) {
            let eventMove = document.createEvent('MouseEvents');  
            eventMove.initMouseEvent('mouseleave', true, false);  
            videoElement.dispatchEvent(eventMove);
        });

        videoElement.addEventListener('canplay', function  ()  {
            this.canvasInterval = setInterval(zlplayer.prototype.drawCanvasFrame.bind(this), 25);
        }.bind(this));

        videoElement.addEventListener('ended', function () {
            if (this.canvasInterval) {
                clearInterval(this.canvasInterval);
                this.canvasInterval = null;
            }
        }.bind(this));
    }

    if (!config.isLive) {
        this.controlbar = new controlbar(this.videoElement, 5000);
    }
    
    window.addEventListener('resize', this.onBodyResize.bind(this)); 
    
    let flvPlayer = flvjs.createPlayer(this.flvSrc, this.streamConfig);
   
    flvPlayer.on('error', function (type, reason, desc) {
        switch (type) {
            case 'MediaError':
                if (reason == 'NeedReplay') {
                    let ctx = this.canvas.getContext('2d');
                    this.canvas.width = this.videoElement.offsetWidth;
                    this.canvas.height = this.videoElement.offsetHeight;
                    ctx.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);
                    let image = this.canvas.toDataURL('image/png');
                    this.videoElement.poster = image;
                    //this.resume();   去掉，改由外面用户自己重新打开 v1.5.1
                }
                break;
            case 'NetworkError':
                if (desc.code == -999) {
                    let ctx = this.canvas.getContext('2d');
                    this.canvas.width = this.videoElement.offsetWidth;
                    this.canvas.height = this.videoElement.offsetHeight;
                    ctx.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);
                    let image = this.canvas.toDataURL('image/png');
                    this.videoElement.poster = image;
                    //this.resume(); 去掉，改由外面用户自己重新打开 v1.5.1
                }
                break;
            default:
                this.videoElement.poster = '#000000';
        }

        zlplayer.logger.write('zlplayer', 'error', `play error : type[${type}] reason[${reason}]desc[${JSON.stringify(desc)}]`);

    }.bind(this));

    flvPlayer.attachMediaElement(this.videoElement);
    this.flvPlayer = flvPlayer;

    if (config.enableFillWindow) {
        setCss3(this.videoElement, {'object-fit': 'fill'});
    }

    if (config.rotate) {
        this.rotate(config.rotate);
    }

    //去除右键事件
    videoElement.addEventListener('contextmenu', function (e) {
        e.preventDefault();
    });

    //双击全屏/取消全屏
    videoElement.addEventListener('dblclick', function () {
        if (!this.enableFullScreen) {
            return;
        }
        //自己实现全屏（铺满整个window可视区域）
        if (this.useCustomFullScreen) {
            this.isFullScreen = !this.isFullScreen;
            if (this.isFullScreen) {
                this.videoElement.style.width = '100%';
                this.videoElement.style.height = '100%';
                this.videoElement.style.position = 'absolute';
                this.videoElement.style.zIndex = 9999;
                setCss3(this.videoElement, {'object-fit': 'contain'});
            }
            else
            {
                this.videoElement.style.position = 'static';
                this.videoElement.style.zIndex = 0;
                setCss3(this.videoElement, {'object-fit': 'fill'});
            }
            this.onBodyResize();
            if (this.controlbar) {
                this.controlbar.resize();
            }
            return;
        }
        //使用原生的全屏
        let videoElement = this.videoElement;
        if (videoElement.fullscreenElement) {
            if (videoElement.mozCancelFullScreen) {
                videoElement.mozCancelFullScreen();
            }
            else {
                videoElement.webkitCancelFullscreen();
            }
            this.isFullScreen = false;
        } else {
            if (videoElement.mozRequestFullScreen) {
                videoElement.mozRequestFullScreen();
            }
            else
            {
                videoElement.webkitRequestFullScreen();
            }
            this.isFullScreen = true;
        }
    }.bind(this));
     
    //*报警记录中的窗口自动竖向拉长  comment by liuguifang at 20180711
    if (Browser.safari) {
        // 规避了safari 播放时会白屏（resize或点击其他控件失去焦点后恢复）
        videoElement.addEventListener('canplay', function  ()  {
            videoElement.style.width = (parseInt(videoElement.style.width) - 2) + 'px';
            this.onBodyResize();
        }.bind(this));
    }
        
    return this;
};

zlplayer.version = '2.0.10';

zlplayer.logger = new Logger('zlplayer-log');

zlplayer.playerMap = new Map();

zlplayer.resPath = '../js/plugin/';

/**
 *
     创建播放器并绑定video dom
 *
 @method +createPlayer  
 *
 @for zlplayer
 *
 @param {videoElement object} 播放器绑定的video dom 
 *    
 @param {config object} 播放器配置 
 *    
 @return {FLVPlayer}  播放器对象
 */
zlplayer.createPlayer = function (videoElement, config) {
    let player = new zlplayer(videoElement, config);
    zlplayer.playerMap.set(player, player);
    return player;
};

/**
 *
    销毁某个播放器
 *
 @method +destroyPlayer  
 *
 @for zlplayer
 *
 @param {zlplayer object} 播放器对象
   
 @return {void}  
 */
zlplayer.destroyPlayer = function (player) {
    if (player) {
        player.stop();
        if (player.isDrawingRgn) {
            player.stopRelexRgn();
        } 
    }
    zlplayer.playerMap.delete(player);
    player = null;
};

/**
 *
    销毁所有播放器
 *
 @method +clearPlayer  
 *
 @for zlplayer
 *
 @return {void}  
 */
zlplayer.clearPlayer = function () {
    for (let player of zlplayer.playerMap.values()) {
        if (player) {
            player.stop();
            player = null;
        }
    }
    zlplayer.playerMap.clear();
};

/**
 *
     开始播放
 *
 @method -play  
 *
 @for zlplayer
 *
 @return {void}  
 */
zlplayer.prototype.play = function () {

    zlplayer.logger.write('zlplayer', 'debug', `play config :${JSON.stringify(this.streamConfig)}`);

    this.flvPlayer.load();
    this.flvPlayer.play();
    if (this.controlbar) {
        this.controlbar.show();
    }
};

/**
 *
     停止播放
 *
 @method -play  
 *
 @for zlplayer
 *
 @return {void}  
 */
zlplayer.prototype.stop = function () {
    if (this.flvPlayer) {
        this.videoElement.poster = '#000000';
        this.flvPlayer.unload();
        this.flvPlayer.destroy();
        this.flvPlayer = null;
    }
    this.clearRelexRgn();
    if (this.controlbar) {
        this.controlbar.hide();
    }
    if (this.canvasInterval) {
        clearInterval(this.canvasInterval);
        this.canvasInterval = null;
    }
    if (this.canvas) {
        this.canvas.style.display = 'none';
        if (this.canvas.parentNode == this.videoElement.parentNode && this.videoElement.parentNode) {
            this.videoElement.parentNode.removeChild(this.canvas);
        }
    }
    if (this.rgnCanvas) {
        this.rgnCanvas.style.display = 'none';
        if (this.rgnCanvas.parentNode == this.videoElement.parentNode && this.videoElement.parentNode) {
            this.videoElement.parentNode.removeChild(this.rgnCanvas);
        }
    }

    zlplayer.logger.write('zlplayer', 'debug', `stop config :${JSON.stringify(this.streamConfig)}`);
};


zlplayer.prototype.resume = function () {
    //in url, parse username and password in url
    let posStart = this.flvSrc.url.indexOf('//') + 2;
    let posEnd = this.flvSrc.url.indexOf('@');
    if (posEnd >= 0) {
        let usrInfo = this.flvSrc.url.substring(posStart, posEnd);
        let posSplit = usrInfo.indexOf(':');
        if (posSplit > 0) { 
            this.flvSrc.url = this.flvSrc.url.substring(0, posStart) + this.flvSrc.url.substring(posEnd + 1);
        }
    } 
    if (this.flvPlayer) {
        this.flvPlayer.resume(this.flvSrc.url);
    }
};

/**
 *
    旋转
 *
 @method -rotate
 *
 @param  deg  角度
 *
 @for zlplayer
 *
 @return {void}  
 */
zlplayer.prototype.rotate = function (deg) {
    if (this.videoElement.rotate != deg) {
        if (deg == 90 || deg == 180 || deg == 270 || deg == 360 || deg == 0) {
            if (deg == 360) {
                deg = 0;
            }
            if (270 == this.videoElement.rotate) {
                this.videoElement.rotate = -90;
            }
            this.videoElement.rotate = deg;  
        }
    }
    if (this.onBodyResize) {
        this.onBodyResize();
    } 
};

/**
 *
     设置事件回调
 *
 @method -setEventCb  
 *
 @for zlplayer
 *
 @param {eventCb cb function}      function(type,reason,desc)
 *    
 @return {void}  
 */
zlplayer.prototype.setEventCb = function (eventCb) {
    if (this.flvPlayer) {
        this.flvPlayer.on('error', eventCb);
    }
};

zlplayer.prototype.on = function (name, func) {
    if (this.flvPlayer) {
        if (name == 'error') {
            this.flvPlayer.on('error', func);
        }
    }
};


/**
 *
    抓图
 *
 @method -capture  
 *
 @for zlplayer
 * 
 @return {void}  
 */
zlplayer.prototype.capture = function () {
    //draw image
    if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        this.canvas.display = 'none';
    }
    let ctx = this.canvas.getContext('2d');
    this.canvas.width = this.videoElement.videoWidth;
    this.canvas.height = this.videoElement.videoHeight;
    ctx.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);  
    
    //create image link and sava file
    let image = this.canvas.toDataURL('image/png').replace('image/png', 'image/octet-stream'); 
    this.onBodyResize();
    return image;
};

/**
 *
    开始录像
 *
 @method -startRecord  
 *
 @for zlplayer
 * 
 @return {image object}  
 */
zlplayer.prototype.startRecord = function () {
    //safari not support 'captureStream'
    if (this.recoding) {
        return;
    }
    if (this.flvPlayer) {
        this.videoElement.captureStream = this.videoElement.captureStream || this.videoElement.mozCaptureStream;
        if (!this.videoElement.captureStream) {
            alert('需要您的浏览器支持，Chrome 需要开启“实验性网络平台”选项\n（浏览器地址栏输入： chrome://flags/#enable-experimental-web-platform-features   点击“enable”或者“开启”）, Safari，Edge，IE等不支持');
            return;
        }
        let options = {mimeType: 'video/webm'};
        if (!this.mediaRecorder) {
            this.mediaRecorder = new MediaRecorder(this.videoElement.captureStream(), options);
            this.mediaRecorder.onstop = function () { console.log('player stoped'); };
            this.mediaRecorder.ondataavailable = function (event) {
                if (event.data && event.data.size > 0 && this.recordedBlobs) {
                    this.recordedBlobs.push(event.data);
                }
            }.bind(this);
        }
        
        this.recordedBlobs = new Array();
    }
    this.mediaRecorder.start(10);
    this.recoding = true;
};

/**
 *
    停止录像
 *
 @method -stopRecord  
 *
 @for zlplayer
 * 
 @return {blob object}  
 */
zlplayer.prototype.stopRecord = function () {
    if (!this.recoding) {
        return;
    }
    this.mediaRecorder.stop();
    this.recoding = false;
    if (this.recordedBlobs && this.recordedBlobs.length > 0) {
        let blob = new Blob(this.recordedBlobs, {type: 'video/webm'});
        this.recordedBlobs = null;
        return blob;
    }
    return null;
};

/**
 *
    调整宽高（主要是旋转后的调整）
 *
 @method -onBodyResize  
 *
 @for zlplayer
 * 
 @return {void}  
 */
zlplayer.prototype.onBodyResize = function () {

    let element = this.videoElement;
    if (!element) {
        return;
    }

    let showRgn = this.isFullScreen && this.useCustomFullScreen ? {width: window.innerWidth, height: window.innerHeight} 
    : {width: this.videoElement.parentNode.offsetWidth, height: this.videoElement.parentNode.offsetHeight};

    let isVertical = element.rotate && element.rotate == 90 || element.rotate == 270;
    if (element.widthX) {
        if (isVertical) {
            element.style.height = showRgn.width * element.widthX / 100.0 + 'px';
        }
        else {
            element.style.width = showRgn.width * element.widthX / 100.0 + 'px';
        }
    }
    if (element.heightX) {
        if (isVertical) {
            element.style.width = showRgn.height * element.heightX / 100.0 + 'px';
        }
        else {
            element.style.height = showRgn.height * element.heightX / 100.0 + 'px';
        }
    }
    let xOffset = 0;
    if (element.rotate && element.rotate == 90) {
        xOffset = (parseInt(element.offsetHeight) - parseInt(element.offsetWidth)) / 2; 
    }
    else if (element.rotate && element.rotate == 270) {
        xOffset = (parseInt(element.offsetWidth) - parseInt(element.offsetHeight)) / 2;  
    }

    setCss3(element, {'transform': `rotate(${element.rotate}deg) translate(${-xOffset}px, ${-xOffset}px)`}); 

   
    if (this.isDrawingRgn) {

        if (this.rgnCanvas) {
            this.rgnCanvas.width = isVertical ? element.offsetHeight : element.offsetWidth;
            this.rgnCanvas.height = isVertical ?  element.offsetWidth : element.offsetHeight;
            this.rgn.cx = isVertical ? element.offsetHeight : element.offsetWidth;
            this.rgn.cy = isVertical ? element.offsetWidth : element.offsetHeight;
        }

        setTimeout(function () {
            if (this.rgn && this.rgn.points.length) {
                this.onUpdateRgn();
            }
        }.bind(this), 100);
    }
    if (this.controlbar) {
        this.controlbar.resize();
    }

    if (this.canvas) {
        this.canvas.style.top = `${element.offsetTop}px`;
        this.canvas.style.left = `${element.offsetLeft}px`;
        this.canvas.width = isVertical ? element.offsetHeight : element.offsetWidth;
        this.canvas.height = isVertical ?  element.offsetWidth : element.offsetHeight;
    }
};

/**
 *
    开始绘制区域
 *
 @method -startRelexRgn  
 *
 @for zlplayer
  *
 @param {minPoints integer , rgn min point count}  
 *
 @param {maxPoints integer , rgn max point count}    
 *
 @param {initRgn rgn Object }    
 *
 @return {void}  
 */
zlplayer.prototype.startRelexRgn = function (minPoints, maxPoints, initRgn) {
    if (this.isDrawingRgn) {
        this.stopRelexRgn();
    }
    if (minPoints) {
        this.minRelexRgnPtCount = minPoints;
    }
    if (maxPoints) {
        this.maxRelexRgnPtCount = maxPoints;
        if (minPoints > maxPoints) {
            this.minRelexRgnPtCount = maxPoints;
        }
    }
    if (!this.minRelexRgnPtCount) {
        this.minRelexRgnPtCount = 3;
    }
    if (!this.maxRelexRgnPtCount) {
        this.maxRelexRgnPtCount = 8;
    }
    this.isRgnEditing = false;
    this.isRgnComplete = false;

    if (!this.rgnCanvas) {
        this.rgnCanvas = document.createElement('canvas');
        if (this.videoElement.parentNode) {
            this.videoElement.parentNode.appendChild(this.rgnCanvas);
        }
    }
    this.rgnCanvas.width = this.videoElement.offsetWidth;
    this.rgnCanvas.height = this.videoElement.offsetHeight;
    this.rgnCanvas.style.zIndex = 100;
    this.rgnCanvas.style.display = '';
    this.rgnCanvas.style.position = 'absolute';
    this.rgnCanvas.style.left = this.videoElement.offsetLeft + 'px';
    this.rgnCanvas.style.top = this.videoElement.offsetTop + 'px';

    this.rgn = {};
    this.rgn.origin = initRgn && initRgn.origin ? initRgn.origin : 'left-top';
    this.rgn.cx = this.videoElement.offsetWidth;
    this.rgn.cy = this.videoElement.offsetHeight;
    this.rgn.points = [];
    this.rgn.minPoints = this.minRelexRgnPtCount;
    this.rgn.maxPoints = this.maxRelexRgnPtCount;

    if (!this.isDrawingRgn) {
        this.isDrawingRgn = true;
    }
    this.isRgnComplete = this.isRgnEditing = initRgn && initRgn.points && initRgn.points.length;
    this.isInitRgn = initRgn && initRgn.points && initRgn.points.length;
    
    //点击增加一个点 或者 闭合后编辑区域
    this.rgnCanvas.onclick = function (event) {
        let ox = event.offsetX;
        let oy = event.offsetY;
        if (!this.isDrawingRgn) {
            return;
        }
        if (this.rgn.maxPoints > this.rgn.points.length && !this.isRgnComplete) {
            if (this.rgn) {
                let newPt = {xaxis: ox / this.rgnCanvas.width, yaxis: oy / this.rgnCanvas.height};
                this.rgn.points.push(newPt);
            }
        }
        if (this.rgn.points.length >= this.rgn.maxPoints && !this.isRgnComplete)
        {
            this.isRgnComplete = true;
            this.isRgnEditing = true;
        }
        if (this.isDrawingRgn) {
            this.onUpdateRgn();
        }
        let ctx = this.rgnCanvas.getContext('2d');  
        ctx.strokeStyle = 'red';   
        ctx.lineWidth = 2.0;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        //ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox, oy);
        //ctx.closePath();
        ctx.stroke();
    }.bind(this);

    //如果拖动光标，且光标在控制点上时，拖动区域
    this.rgnCanvas.onmousemove = function (event) {
        function hitPoint(ptSrc, ptDst) {
            if (ptSrc && ptDst) {
                let distance = Math.sqrt((ptSrc.xaxis - ptDst.xaxis) * (ptSrc.xaxis - ptDst.xaxis) + (ptSrc.yaxis - ptDst.yaxis) * (ptSrc.yaxis - ptDst.yaxis));
                //console.log(`distance is ${distance}`);
                return distance < 12;
            }
            return false;
        }
        if (this.isRgnEditing && event.buttons) {
            //两个点是否命中点
            
            //光标的点与区域的控制点基本命中时移动控制点到光标位置
            for (let i = 0; i < this.rgn.points.length; i++) {
                let ox = this.rgn.points[i].xaxis * this.rgn.cx; 
                let oy = this.rgn.points[i].yaxis * this.rgn.cy; 
                if (hitPoint({xaxis: event.offsetX, yaxis: event.offsetY}, {xaxis: ox, yaxis: oy})) {
                    this.rgn.points[i].xaxis = event.offsetX / this.rgn.cx;
                    this.rgn.points[i].yaxis = event.offsetY / this.rgn.cy;
                    setTimeout(function () {
                        this.onUpdateRgn();
                    }.bind(this), 50);
                    break;
                }
            }
        }
    }.bind(this);
 
    //右键，取消/结束区域绘制  变为可编辑状态
    this.rgnCanvas.oncontextmenu = function (event) {
        this.ptMouse = null;
        if (this.rgn.points.length < this.rgn.minPoints) {
            //no more pts to draw a rgn
            this.rgn.points = [];
        }
        else {
            this.isRgnComplete = true;
            this.isRgnEditing = true;
        }
        
        if (this.isDrawingRgn) {
            this.onUpdateRgn();
        }
        
        return false;
    }.bind(this);
    
    //更新绘图区域
    this.onUpdateRgn = function () {
        let ctx = this.rgnCanvas.getContext('2d');  
        ctx.clearRect(0, 0, this.videoElement.offsetWidth, this.videoElement.offsetHeight);
        ctx.strokeStyle = 'red';
        ctx.fillStyle = 'yellow';    
        ctx.lineWidth = 2.0;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (this.rgn && this.rgn.points.length) {
            ctx.beginPath();
            /*this.rgn.points.forEach(function(pt){
                ctx.arc (pt.xaxis, pt.yaxis, 4, 0, 2 * Math.PI, false); 
            });
            ctx.fill();*/
            //连接每一个点
            let ptLast = null;
            let ptFirst = this.rgn.points[0];
            for (let i = 0; i < this.rgn.points.length; i++) {
                let pt = Object.assign({}, this.rgn.points[i]);

                if (!ptLast) {
                    ptLast = pt;
                }

                let penPt = {xaxis: ptLast.xaxis * this.rgn.cx, yaxis: ptLast.yaxis * this.rgn.cy};

                ctx.moveTo(penPt.xaxis, penPt.yaxis);
                penPt = {xaxis: pt.xaxis * this.rgn.cx, yaxis: pt.yaxis * this.rgn.cy};
                ctx.lineTo(penPt.xaxis, penPt.yaxis); 
                ptLast = pt;

                //编辑的时候显示可拖动的点
                if (this.isRgnEditing) {
                    ctx.moveTo(penPt.xaxis, penPt.yaxis);
                    ctx.arc(penPt.xaxis, penPt.yaxis, 4, 0, Math.PI * 2, true);
                }
            }
            //结束后连接起始点与结束点
            if (this.isRgnComplete) {
                let penPt = {xaxis: ptLast.xaxis * this.rgn.cx, yaxis: ptLast.yaxis * this.rgn.cy};
                ctx.moveTo(penPt.xaxis, penPt.yaxis);
                ptLast = ptFirst;
                penPt = {xaxis: ptLast.xaxis * this.rgn.cx, yaxis: ptLast.yaxis * this.rgn.cy};
                ctx.lineTo(penPt.xaxis, penPt.yaxis); 
            }
            else
            {
                /*
                //连接光标的弹簧线
                if (this.ptMouse) {
                    ctx.lineWidth = 1.0;
                    //ctx.strokeStyle = "yellow";
                    let ptEnd = this.rgn.points[this.rgn.points.length-1];
                    ctx.moveTo(ptEnd.xaxis*this.rgn.cx, ptEnd.yaxis*this.rgn.cy);
                    ctx.lineTo(this.ptMouse.xaxis, this.ptMouse.yaxis);
                }*/
            }
            ctx.closePath();
            ctx.stroke();
        }
    }.bind(this);

    //显示设置的区域
    if (initRgn && initRgn.points) {
        for (let i = 0; i < initRgn.points.length; i++) {
            let ox = initRgn.points[i].xaxis / initRgn.cx; 
            let oy = initRgn.points[i].yaxis / initRgn.cy; 
            if ('left-bottom' == initRgn.origin) {
                oy = 1 - oy;
            }
            else if ('right-top' == initRgn.origin) {
                ox = 1 - ox;
            }
            else if ('right-bottom' == initRgn.origin) {
                ox = 1 - ox;
                oy = 1 - oy;
            }
            this.rgn.points.push({xaxis: ox, yaxis: oy});
            this.onUpdateRgn();
        }
    }
};


/**
 *
    停止绘制区域
 *
 @method -stopRelexRgn  
 *
 @for zlplayer
 * 
 @param {callback cb function}      function(player, rgns)
 * 
 @return {void}  
 */
zlplayer.prototype.stopRelexRgn = function (callback) {
    this.isRgnComplete = true;
    this.isRgnEditing = false;
    this.isInitRgn = false;
    this.onUpdateRgn();

    //回调区域
    if (callback && this.rgn && this.rgn.points) {
        let rgnResult = {};
        rgnResult.points = [];
        rgnResult.cx = this.rgn.cx;
        rgnResult.cy = this.rgn.cy;
        rgnResult.minPoints = this.rgn.minPoints;
        rgnResult.maxPoints = this.rgn.maxPoints;
        for (let i = this.rgn.points.length - 1; i >= 0; i--) {
            let pt = {};
            pt.xaxis = parseInt(this.rgn.points[i].xaxis * this.rgn.cx);
            pt.yaxis = parseInt(this.rgn.points[i].yaxis * this.rgn.cy);
            
            let originDirect = this.rgn.origin;
            if (originDirect) {
                //origin direction is 'left-top'
                if ('left-bottom' == originDirect) {
                    pt.yaxis = this.rgn.cy - pt.yaxis;
                }
                else if ('right-top' == originDirect) {
                    pt.xaxis = this.rgn.cx - pt.xaxis;
                }
                else if ('right-bottom' == originDirect) {
                    pt.xaxis = this.rgn.cx - pt.xaxis;
                    pt.yaxis = this.rgn.cy - pt.yaxis;
                }
            }

            rgnResult.origin = this.rgn.origin;
            rgnResult.points.push(pt);
        }
        callback(this, rgnResult);
    }
};

/**
 *
    清除绘制区域
 *
 @method -clearRelexRgn  
 *
 @for zlplayer
 * 
 @return {void}  
 */
zlplayer.prototype.clearRelexRgn = function () {
    this.isRgnComplete = true;
    this.isDrawingRgn = false;
    this.isInitRgn = false;
    this.rgn = null;
    this.ptMouse = null;
    if (this.rgnCanvas) {
        this.rgnCanvas.style.display = 'none';
    } 
};

/**
 *
    canvas 绘制视频帧
 *
 @method -drawCanvasFrame  
 *
 @for zlplayer
 * 
 @return {void}  
 */

zlplayer.prototype.drawCanvasFrame = function () {
    let ctx = this.canvas.getContext('2d');
    ctx.filter = this.filter;
    ctx.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);  
};