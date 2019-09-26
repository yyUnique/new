(function(){
  resizeFuc();
  window.onresize = function(){
      resizeFuc();
  }
})();
function resizeFuc(){
  var deviceWidth = document.documentElement.clientWidth;
  document.documentElement.style.fontSize = deviceWidth/19.2 + 'px';
}