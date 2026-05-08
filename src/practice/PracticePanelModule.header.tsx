/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Lock, Search, Piano, Repeat, X } from 'lucide-react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { Midi } from '@tonejs/midi';
import * as Tone from 'tone';
import type { Track } from '../types/track';
import type { View } from '../types/view';
import type {
  PracticeMidiHeaderLite,
  PracticeSeekDebug,
  MusicalPosition,
  PracticeMeasureTimelineEntry,
} from './practice-types';
import { assignSingleTrackMidiHandsFromMusicXml } from '../musicxml-hand-utils';

