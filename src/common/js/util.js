import Vue from "vue";
import { TokenKeys } from '@/common/js/variable'
// 获取当前时间
export function getNowTime() {
  var d = new Date();
  var year = d.getFullYear();
  var month = d.getMonth() + 1;
  var date = d.getDate();
  var days = new Array("日", "一", "二", "三", "四", "五", "六");
  var day = d.getDay();
  var hour = (d.getHours() < 10) ? ("0" + d.getHours()) : d.getHours();
  var min = (d.getMinutes() < 10) ? ("0" + d.getMinutes()) : d.getMinutes();
  var sec = (d.getSeconds() < 10) ? ("0" + d.getSeconds()) : d.getSeconds();
  var nowTime = year + "." + month + "." + date + " " + hour + ":" + min;

  return nowTime;
}
export function getEditHtml(str) {
  if (!str) {
    return;
  }
  return str.replace(/<img/g, "<img style=\'width:100%\'")
}
//获取字体宽度换行
export function measureCanvasFont(text, maxWidth, fontSize) {
  let measureCanvas = document.createElement("canvas");
  let measureCtx = measureCanvas.getContext("2d");
  if (!text) {
    return [];
  }
  let chr = text.split("");
  let temp = "";
  let row = [];
  for (var a = 0; a < chr.length; a++) {
    if (measureCtx.measureText(temp).width < maxWidth - 2 * fontSize) {
      temp += chr[a];
    } else {
      a--;
      row.push(temp);
      temp = "";
    }
  }
  row.push(temp);
  measureCtx = null;
  measureCanvas - null;
  return row
}
//表情转换编码
export function utf16toEntities(str) {
  if (!str) {
    return str
  }
  var patt = /[\ud800-\udbff][\udc00-\udfff]/g;
  // 检测utf16字符正则
  str = str.replace(patt, function (char) {
    var H, L, code;
    if (char.length === 2) {
      H = char.charCodeAt(0);
      // 取出高位
      L = char.charCodeAt(1);
      // 取出低位
      code = (H - 0xD800) * 0x400 + 0x10000 + L - 0xDC00;
      // 转换算法
      return "&#" + code + ";";
    } else {
      return char;
    }
  });
  return str;
};
//表情转换解码
export function entitiestoUtf16(str) {
  if (!str) {
    return ''
  }
  // 检测出形如&#12345;形式的字符串
  var strObj = utf16toEntities(str);
  var patt = /&#\d+;/g;
  var H, L, code;
  var arr = strObj.match(patt) || [];
  for (var i = 0; i < arr.length; i++) {
    code = arr[i];
    code = code.replace('&#', '').replace(';', '');
    // 高位
    H = Math.floor((code - 0x10000) / 0x400) + 0xD800;
    // 低位
    L = (code - 0x10000) % 0x400 + 0xDC00;
    code = "&#" + code + ";";
    var s = String.fromCharCode(H, L);
    strObj = strObj.replace(code, s);
  }
  return strObj;
};
export function getHtmlData(str) {
  if (!str) {
    return '';
  }
  let newStr = entitiestoUtf16(str).replace('<', '&lt;').replace('>', '&gt;').replace(/\n|\r\n/g, "<br>").replace(/[ ]/g, "&nbsp;");
  return newStr;
};
export function getType(obj) {
  let toString = Object.prototype.toString;
  let map = {
    '[object Boolean]': 'boolean',
    '[object Number]': 'number',
    '[object String]': 'string',
    '[object Function]': 'function',
    '[object Array]': 'array',
    '[object Date]': 'date',
    '[object RegExp]': 'regExp',
    '[object Undefined]': 'undefined',
    '[object Null]': 'null',
    '[object Object]': 'object'
  };
  if (obj instanceof Element) {
    return 'element';
  }
  return map[toString.call(obj)];
};

export function deepClone(data) {
  let type = getType(data);
  let obj;
  if (type === 'array') {
    obj = [];
  } else if (type === 'object') {
    obj = {};
  } else {
    return data;
  }
  if (type === 'array') {
    for (let i = 0, len = data.length; i < len; i++) {
      obj.push(deepClone(data[i]));
    }
  } else if (type === 'object') {
    for (let key in data) {
      obj[key] = deepClone(data[key]);
    }
  }
  return obj;
};
//验证手机号
export function checkPhone(mobile) {
  let reg = /(^(0[0-9]{2,3}\-)?([2-9][0-9]{6,7})+(\-[0-9]{1,4})?$)|(^((\(\d{3}\))|(\d{3}\-))?(1[3456789]\d{9})$)/;
  return reg.test(mobile)
};
export function checkExpression(str) {
  let emoji = /[\ud800-\udbff][\udc00-\udfff]/;
  //   let reg = new RegExp("[`~!@#$^&*()=|{}':;',\\[\\].<>/?~！@#￥……&*（）——|{}【】‘；：”“'。，、？]");
  if ((!str) || emoji.test(str) || (str.trim() === '')) {
    return false;
  }
  return true;
}
/**
 * author:langwenqi
 * date: 2018/5/20
 * describe:验证手机号
 * params:{
 *
 * }
 **/
export function checkMobile(mobile) {
  let reg = /^1[0-9]{10}$/;
  return reg.test(mobile)
};

//找到对象摸个属性并删除
export function deleteObjPrototype(obj = {}, p) {
  if (!obj[p]) return obj;
  delete obj[p];
  return obj;
}
//提取html图片src
export function getHtmlImg(strs) {
  let imgReg = /<img.*?(?:>|\/>)/gi;
  let srcReg = /src=[\'\"]?([^\'\"]*)[\'\"]?/i;
  let arr = [];
  if (strs && strs.trim()) {
    arr = strs.match(imgReg);
  }
  console.log('所有已成功匹配图片的数组：' + arr);
  let arr_src = [];
  if (arr) {
    for (var i = 0; i < arr.length; i++) {
      var src = arr[i].match(srcReg);
      //获取图片地址
      if (src[1]) {
        arr_src.push(src[1])
      }
    }
  }
  console.log('截取html生成的数组')
  console.log(arr_src)
  return arr_src;
}

//无头像获取默认头像
export function getDefaultImg(url) {
  return url ? url : TokenKeys.DEFAULT_USER_PHOTO;
}

//计算字符串字节数
export function getBytesLength(str) {
  // 在GBK编码里，除了ASCII字符，其它都占两个字符宽
  return str.replace(/[^\x00-\xff]/g, 'xx').length;
}

//
export function getStr(str, len, ellipsis = false) {
  if (!str) return ''
  var regexp = /[^\x00-\xff]/g;// 正在表达式匹配中文
  // 当字符串字节长度小于指定的字节长度时
  if (str.replace(regexp, "aa").length <= len) {
    return str;
  }
  // 假设指定长度内都是中文
  var m = Math.floor(len / 2);
  for (var i = m, j = str.length; i < j; i++) {
    // 当截取字符串字节长度满足指定的字节长度
    if (str.substring(0, i).replace(regexp, "aa").length >= len) {
      if (!ellipsis) {
        return str.substring(0, i) + '...';
      } else {
        return str.substring(0, i);
      }
    }
  }
  return str;
}
//判断是否为大于0整数，用于库存判断
export function isInteger(str) {
  var reg = /^\+?[1-9]\d*$/;
  return reg.test(str)
}
//判断是否为整数，用于价格
export function isPositiveNumber(str) {
  var reg = /^[+]{0,1}(\d+)$|^[+]{0,1}(\d+\.\d+)$/;
  return reg.test(str)

}
// 精确乘法
export function mul(arg1 = 0, arg2 = 0) {
  var m = 0, s1 = arg1.toString(), s2 = arg2.toString();
  try {
    m += s1.split(".")[1].length;
  }
  catch (e) {
  }
  try {
    m += s2.split(".")[1].length;
  }
  catch (e) {
  }
  return Number(s1.replace(".", "")) * Number(s2.replace(".", "")) / Math.pow(10, m);
}

// 精确除法
export function div(arg1 = 0, arg2 = 1) {
  var t1 = 0, t2 = 0, r1, r2;
  try {
    t1 = arg1.toString().split(".")[1].length;
  }
  catch (e) {
  }
  try {
    t2 = arg2.toString().split(".")[1].length;
  }
  catch (e) {
  }
  r1 = Number(arg1.toString().replace(".", ""));
  r2 = Number(arg2.toString().replace(".", ""));
  return (r1 / r2) * Math.pow(10, t2 - t1);
}
//旋转图片
export function rotateImage(image) {
  console.log('rotateImage');
  var width = image.width;
  var height = image.height;

  var canvas = document.createElement("canvas")
  var ctx = canvas.getContext('2d');

  var newImage = new Image();
  let imageDate;
  //旋转图片操作
  EXIF.getData(image,function () {
      var orientation = EXIF.getTag(this,'Orientation');
      // orientation = 6;//测试数据
      console.log('orientation:'+orientation);
      switch (orientation){
        //正常状态
        case 1:
          console.log('旋转0°');
          // canvas.height = height;
          // canvas.width = width;
          newImage = image;
          break;
        //旋转90度
        case 6:
          console.log('旋转90°');
          canvas.height = width;
          canvas.width = height;
          ctx.rotate(Math.PI/2);
          ctx.translate(0,-height);

          ctx.drawImage(image,0,0)
          imageDate = canvas.toDataURL('Image/jpeg',1)
          newImage.src = imageDate;
          break;
        //旋转180°
        case 3:
          console.log('旋转180°');
          canvas.height = height;
          canvas.width = width;
          ctx.rotate(Math.PI);
          ctx.translate(-width,-height);

          ctx.drawImage(image,0,0)
          imageDate = canvas.toDataURL('Image/jpeg',1)
          newImage.src = imageDate;
          break;
        //旋转270°
        case 8:
          console.log('旋转270°');
          canvas.height = width;
          canvas.width = height;
          ctx.rotate(-Math.PI/2);
          ctx.translate(-height,0);

          ctx.drawImage(image,0,0)
          imageDate = canvas.toDataURL('Image/jpeg',1)
          newImage.src = imageDate;
          break;
        //undefined时不旋转
        case undefined:
          console.log('undefined  不旋转');
          newImage = image;
          break;
        case 0:
          console.log('0  不旋转');
          newImage = image;
          break;
        default:
          newImage = image;
          break;
      }
    }
  );
  return newImage;
}

//限制只能输入中文英文数字
export function changeTxt(txt) {
  return txt.replace(/[^\a-\z\A-\Z0-9\u4E00-\u9FA5]/g,'')
}

export const drawImg = (obj = {
  url: '',
  top: '',
  left: '',
  width: '',
  height: '',
  orgWidth: '',
  orgHeight: '',
  canvasWidth:'',
  canvasHeight:'',
  ifFit: false
}) => {
  let top = obj.top;
  let left = obj.left;
  let width = obj.width;
  let height = obj.height;
  console.log(width,height)

  let canvas = document.createElement("canvas")
  let ctx = canvas.getContext('2d');
  let initOne = () => {
    height = obj.height;
    width = obj.orgWidth * obj.height / obj.orgHeight;
    top = obj.top;
  }
  let initTwo = () => {
    width = obj.width;
    height = obj.orgHeight * obj.width / obj.orgWidth;
    left = obj.left;
  }
  if (obj.ifFit) {
    if (obj.orgWidth / obj.orgHeight > obj.width / obj.height) {
      initTwo();
      top = obj.top + (obj.height - height) / 2;
    } else {
      initOne();
      left = obj.left + (obj.width - width) / 2;
    }
  } else {
    if (obj.orgWidth / obj.orgHeight > obj.width / obj.height) {
      initOne();
      left = obj.left - (width - obj.width) / 2;
    } else {
      initTwo();
      top = obj.top - (height - obj.height) / 2;
    }
  }
  canvas.height =obj.canvasHeight;
  canvas.width = obj.canvasWidth;
  ctx.drawImage(obj.url, left, top,width,height);
  console.log(canvas)
  let url = canvas.toDataURL("image/png").replace("image/png","image/octet-stream");
  return url
};

export function makeFileObj(type, file, endType) {
    let content = {};
    content.type = type;
    content.fileName = file.name;
    content.endType = endType;
    return content;
};
export function handleKey(file) {
    if (!file) {
        return {}
    }
    if (file.type.split('/')[0] == 'image') {
        return makeFileObj(1, file, file.type.split('/')[1]);
    } else if (file.type.split('/')[0] == 'video') {
        return makeFileObj(3, file, file.type.split('/')[1]);
    } else if (file.type.split('/')[1] == 'msword') {
        return makeFileObj(5, file, 'doc');
    } else if (file.type.split('/')[1] == 'vnd.openxmlformats-officedocument.wordprocessingml.document') {
        return makeFileObj(5, file, 'docx');
    } else if (file.type.split('/')[1] == 'vnd.ms-excel') {
        return makeFileObj(7, file, 'xls');
    } else if (file.type.split('/')[1] == 'vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
        return makeFileObj(7, file, 'xlsx');
    } else if (file.type.split('/')[1] == 'vnd.ms-powerpoint') {
        return makeFileObj(8, file, 'ppt');
    } else if (file.type.split('/')[1] == 'vnd.openxmlformats-officedocument.presentationml.presentation') {
        return makeFileObj(8, file, 'pptx');
    } else if (file.type.split('/')[1] == 'pdf') {
        return makeFileObj(6, file, 'pdf');
    } else if (file.type.split('/')[1] == 'plain') {
        return makeFileObj(4, file, 'txt')
    } else if (file.type.split('/')[0] == 'audio') {
        return makeFileObj(9, file, file.type.split('/')[1]);
    } else {
        return makeFileObj(127, file, file.type.split('/')[1]);
    }
};

//oss图片处理
export function comPressFile(url){
    return `${url}?x-oss-process=image/format,jpg/resize,w_400/auto-orient,1`
}

/**
 * @author: langwenqi
 * @describe: dateFormat
 * @param {DateObject} dateObj
 * @return {String} dateFormat
 */

export function dateFormat(dateObj, format) {
  if(!dateObj)return null;
  let date = dateObj;
  if( typeof dateObj == 'string'){
    date = dateObj.replace(/T/g, ' ').replace(/\.[\d]{3}Z/, '').replace(/(-)/g, '/');
    if(date.indexOf(".")>-1){
      date = date.slice(0, date.indexOf("."));
    }
  }
  var o = {
    "y+": new Date(date).getFullYear(),
    "M+": new Date(date).getMonth() + 1,
    "d+": new Date(date).getDate(),
    "h+": new Date(date).getHours(),
    "m+": new Date(date).getMinutes(),
    "s+": new Date(date).getSeconds(),
  };
  if (/(y+)/.test(format)) format = format.replace(RegExp.$1,
      (new Date(date).getFullYear() + "").substr(4 - RegExp.$1.length));
  for (var k in o) if (new RegExp("(" + k + ")").test(format))
    format = format.replace(RegExp.$1,
        RegExp.$1.length === 1 ? o[k] :
            ("00" + o[k]).substr(("" + o[k]).length));
  return format;
}
/**
 * @author: langwenqi
 * @describe: get startTime and endTime
 * @param {DateObject} time
 * @param {Boolean or Number} will get startTime or endTime
 * @return {String} startTime or endTime
 */
export function getSendTime(time,type) {
  if(!time)return null;
  let date = time;
  if(typeof time == 'string'){
    date = time.replace(/T/g, ' ').replace(/\.[\d]{3}Z/, '').replace(/(-)/g, '/');
    if(date.indexOf(".")>-1){
      date = date.slice(0, date.indexOf("."));
    }
  }
  let calcTime='';
  if(type){
    calcTime = new Date(date).setHours(0, 0, 0, 0);
  }else{
    calcTime = new Date(date).setHours(23, 59, 59, 0);
  }
  date = new Date(calcTime).getTime();
  return date;
}

/**
 * @author: langwenqi
 * @describe: get startTime and endTime
 * @param {DateObject} time
 * @param {Boolean or Number} will get startTime or endTime
 * @return {String} startTime or endTime
 */
export function formatDateTime(inputTime) { 
  let date = new Date(inputTime); 
  let y = date.getFullYear(); 
  let m = date.getMonth() + 1; 
  m = m < 10 ? ('0' + m) : m; 
  let d = date.getDate(); 
  d = d < 10 ? ('0' + d) : d; 
  let h = date.getHours(); 
  h = h < 10 ? ('0' + h) : h; 
  let minute = date.getMinutes(); 
  let second = date.getSeconds(); 
  minute = minute < 10 ? ('0' + minute) : minute; 
  second = second < 10 ? ('0' + second) : second; 
  return y + '-' + m + '-' + d + ' ' + h + ':' + minute + ':' + second; 
  }

