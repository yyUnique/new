import axios from './config'
import {getType} from '@/common/js/util'
import {getApiSign} from '@/common/js/apiSign'
import {TokenKeys} from '@/common/js/variable'
import {getSessionToken} from '@/common/js/auth'
import { Loading,Message } from 'element-ui';
import {loginToken} from '../api/apis/auth'
import router from '@/router'
let loadingInstance =null;
// 请求拦截
axios.interceptors.request.use(function (config) {
    console.log('/////')
    console.log(config)
    config.params = config.params ? config.params : {};
    if (config.loading) {
        loadingInstance = Loading.service({ fullscreen: true });
    }
   
    if((!getSessionToken())&&(!config.unPrivate)){
        return loginToken().then(res=>{
            const {code,data} = res;
            if(code == 10000){
                localStorage.setItem(TokenKeys.SESSION_TOKEN,new Date().getTime());
                localStorage.setItem(TokenKeys.ACCESS_TOKEN, data.token);
            }
          return continueDone(config);
        }).catch(res=>{
          return continueDone(config);
        })
    }else{
        return continueDone(config);
    }
    // return continueDone(config);
    function continueDone(config) {
        let accessToken = localStorage.getItem(TokenKeys.ACCESS_TOKEN);
        if (config.method === 'get') {
            config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        } else if (config.method === 'post') {

        }
        
        if(!config.unPrivate){
            const timestamp = new Date().getTime()+'';
            const sign = getApiSign(timestamp);
            config.headers[TokenKeys.ACCESS_TOKEN] = accessToken;
            config.headers.timestamp = timestamp;
            config.headers.sign = sign;  
           
        }
        return config
    }
}, function (error) {
    return Promise.reject(error)
});
// 响应拦截
axios.interceptors.response.use(function (response) {
    response = response.data;
    if(response.code != 10000){
        if ([50004,20021].indexOf(response.code) > -1) {
            if(localStorage.getItem(TokenKeys.ACCESS_TOKEN)){
                Message.error(response.code == 50004?'登录过期，请重新登录':'用户不存在');    
            } 
            router.replace({path:'/login'});   
        }else{
            if (response.msg) {
                Message.warning(response.msg);
            }
        }
    }
    if(loadingInstance){
        loadingInstance.close();
        loadingInstance=null;
    }
    return response

}, function (error) {
    if(loadingInstance){
        loadingInstance.close();
        loadingInstance=null;
    }
    return Promise.reject(error)
});
export default axios
