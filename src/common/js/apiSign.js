import {
  TokenKeys
} from './variable'
import md5 from './md5'

const getApiSign = (timestamp) => {
  // const data =  Object.assign({}, params);
  // const queryString = Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('&');
  const timestampStr = (timestamp).slice(0, 10);
  const local = localStorage.getItem(TokenKeys.ACCESS_TOKEN);
  const tk = local ? local.slice(0, 6) : ''
  // const signStr = `timestamp=${timestampStr}&tk=${tk}&s=${TokenKeys.SALT}`;
  const signStr = TokenKeys.APP_KEY + timestampStr + TokenKeys.APP_SECRET + tk;
  return md5(signStr);
};
export {
  getApiSign
}