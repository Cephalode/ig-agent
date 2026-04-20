/**
 * @module constants
 * Path constants and default configuration for ig-agent.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOME = homedir();
export const BASE = join(HOME, '.ig-agent');
export const SESSION_FILE = join(BASE, 'session.json');
export const CONFIG_FILE = join(BASE, 'config.json');
export const SEEN_FILE = join(BASE, 'seen.json');
export const LOG_FILE = join(BASE, 'ig-agent.log');
export const PID_FILE = join(BASE, 'daemon.pid');
export const CHATS_DIR = join(BASE, 'chats');
export const AUTH_DIR = join(BASE, 'auth_info_instagram');
export const MEMORY_DIR = join(BASE, 'memory');

export const DEFAULT_CONFIG = {
  allowedSenders: ['ydkshad', 'cephalode', 'dana.seismo_', 'fenpolt', 'pbnjaney'],
  nameMap: {
    'Mesonycho': 'ydkshad',
    'Cephalode': 'cephalode',
    'Dana': 'dana.seismo_',
    'Fenpolt': 'fenpolt',
    'Pbnjaney': 'pbnjaney',
  },
  replyEnabled: true,
};
